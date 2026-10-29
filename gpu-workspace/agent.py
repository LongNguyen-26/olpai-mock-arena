"""Trusted web control plane -> team Pod. LLM stays on localhost and shares GPU 0."""
import asyncio
import hashlib
import hmac
import json
import os
import re
import shutil
import stat
import subprocess
import threading
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(os.getenv("ARENA_WORKSPACE_ROOT", "/workspace"))
SERVICES = os.getenv("ARENA_WORKSPACE_SERVICES", "both")
if SERVICES not in ("both", "llm", "jupyter"):
    raise ValueError("Invalid workspace services")
HAS_LLM = SERVICES in ("both", "llm")
HAS_JUPYTER = SERVICES in ("both", "jupyter")
STATE = {"stage": "Khởi động", "publicReady": False, "privateReady": False, "error": None}
MODEL_PROCESS = None
MODEL_ERROR = None
MODEL_LOCK = threading.Lock()
MODEL_ENABLED = threading.Event()
MODEL_RUN_ID = None
MODEL_STAGE = "Đang chờ public mở"
MODEL_FINGERPRINT = ""
POLICY_EXPIRES_AT = 0
PUBLIC_ENDS_AT = None
LLAMA_URL = "http://127.0.0.1:8080"
STOP = threading.Event()
GENERATING = asyncio.Lock()

def stop_model():
    """Release the LLM's VRAM for private inference and after an invalidated run."""
    with MODEL_LOCK:
        if MODEL_PROCESS is not None and MODEL_PROCESS.poll() is None:
            MODEL_PROCESS.terminate()
            try:
                MODEL_PROCESS.wait(timeout=5)
            except subprocess.TimeoutExpired:
                MODEL_PROCESS.kill()
                MODEL_PROCESS.wait(timeout=5)

def apply_policy(policy):
    global MODEL_RUN_ID, MODEL_STAGE, POLICY_EXPIRES_AT, PUBLIC_ENDS_AT
    enabled = bool(HAS_LLM and policy.get("active") and policy.get("llmEnabled"))
    run_id = policy.get("runId")
    POLICY_EXPIRES_AT = policy.get("policyExpiresAt", 0) / 1000
    PUBLIC_ENDS_AT = policy.get("publicEndsAt")
    if MODEL_RUN_ID != run_id:
        stop_model()
        MODEL_RUN_ID = run_id
    STATE["chatLocked"] = not enabled
    if enabled:
        MODEL_ENABLED.set()
    else:
        MODEL_ENABLED.clear()
        stop_model()
        MODEL_STAGE = "DeepSeek khóa ngoài public; đã trả VRAM"

async def auth(authorization: str | None = Header(default=None)):
    expected = "Bearer " + os.environ["ARENA_AGENT_TOKEN"]
    if not hmac.compare_digest(authorization or "", expected):
        raise HTTPException(401, "Unauthorized")

def manifest():
    with httpx.Client(timeout=30, follow_redirects=False) as client:
        response = client.get(os.environ["ARENA_CONTROL_URL"], params={"id": os.environ["ARENA_WORKSPACE_ID"]}, headers={"Authorization": "Bearer " + os.environ["ARENA_AGENT_TOKEN"]})
        response.raise_for_status()
        return response.json()

def safe_extract(archive: Path, destination: Path, task_root=False):
    """Reject ZIP traversal, symlinks and archives exceeding the extraction budget."""
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if sum(m.file_size for m in members) > 50 * 1024**3:
            raise ValueError("Archive too large")
        for member in members:
            path = PurePosixPath(member.filename.replace("\\", "/"))
            if task_root and (not path.parts or not re.fullmatch(r"Tac_vu_[1-3]", path.parts[0])):
                raise ValueError("Invalid task root")
            if path.is_absolute() or ".." in path.parts or any(":" in p for p in path.parts) or stat.S_ISLNK(member.external_attr >> 16):
                raise ValueError("Unsafe ZIP entry")
            target = (destination / str(path)).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError("Unsafe ZIP target")
        bundle.extractall(destination)

def load_asset(asset: dict):
    name = asset["name"]
    if Path(name).name != name or "\\" in name or name in (".", ".."):
        raise ValueError("Invalid asset name")
    task_root = asset.get("workspaceLayout") == "task-root"
    destination = ROOT if task_root else ROOT / "data" / asset["phase"]
    destination.mkdir(parents=True, exist_ok=True)
    cache = ROOT / ".arena" / "downloads"
    cache.mkdir(parents=True, exist_ok=True)
    marker = cache / (hashlib.sha256((asset["phase"] + name).encode()).hexdigest() + ".json")
    if marker.exists() and json.loads(marker.read_text()).get("sha256") == asset["sha256"]:
        return
    temp = cache / (marker.stem + ".part")
    try:
        if asset.get("driveId"):
            import gdown
            if not gdown.download(id=asset["driveId"], output=str(temp), quiet=True):
                raise ValueError("Drive download failed")
        else:
            if urlparse(asset["url"]).scheme != "https":
                raise ValueError("HTTPS required")
            with httpx.stream("GET", asset["url"], follow_redirects=True, timeout=120) as response:
                response.raise_for_status()
                with temp.open("wb") as output:
                    for chunk in response.iter_bytes():
                        output.write(chunk)
        digest = hashlib.sha256()
        with temp.open("rb") as source:
            for chunk in iter(lambda: source.read(1024**2), b""):
                digest.update(chunk)
        if temp.stat().st_size != asset["bytes"] or digest.hexdigest() != asset["sha256"]:
            raise ValueError("Dataset checksum mismatch")
        if name.lower().endswith(".zip"):
            safe_extract(temp, destination, task_root=task_root)
        if task_root:
            shutil.move(str(temp), str(cache / name))
        else:
            shutil.move(str(temp), str(destination / name))
        marker.write_text(json.dumps({"sha256": asset["sha256"]}))
    finally:
        temp.unlink(missing_ok=True)

def dataset_loop():
    while not STOP.is_set():
        try:
            policy = manifest()
            apply_policy(policy)
            if not policy.get("active"):
                stop_model()
                STATE.update(publicReady=False, privateReady=False, stage="Lượt thi đã đóng hoặc được đặt lại")
                STOP.wait(20)
                continue
            if not HAS_JUPYTER:
                STATE.update(publicReady=False, privateReady=False, stage="Pod dành cho Chatbot", error=None)
                STOP.wait(20)
                continue
            if policy.get("loadDataset") is False:
                STATE.update(publicReady=False, privateReady=False, stage="Không nạp dataset", error=None)
                STOP.wait(20)
                continue
            for asset in policy["assets"]:
                STATE["stage"] = "Đang nạp " + asset["name"]
                load_asset(asset)
            STATE["publicReady"] = True
            STATE["privateReady"] = not policy["privateLocked"]
            if STATE["privateReady"]:
                (ROOT / "data/private/PRIVATE_LOCKED.txt").unlink(missing_ok=True)
            STATE["stage"] = "Dữ liệu sẵn sàng · Private " + ("đã mở" if STATE["privateReady"] else "đang khóa")
            STATE["error"] = None
        except Exception:
            # A brief control-plane outage must not abort a valid in-flight turn.
            if time.time() >= POLICY_EXPIRES_AT:
                MODEL_ENABLED.clear()
                stop_model()
            # Never leak a signed URL, request header, or provider exception to the browser/log.
            STATE["error"] = "Chưa nạp được dataset. Agent sẽ thử lại; kiểm tra link Drive, checksum và dung lượng."
        STOP.wait(20)

def model_worker():
    global MODEL_PROCESS, MODEL_ERROR, MODEL_STAGE, MODEL_FINGERPRINT
    while not STOP.is_set():
        if not MODEL_ENABLED.is_set():
            STOP.wait(2)
            continue
        if MODEL_PROCESS is not None and MODEL_PROCESS.poll() is None:
            STOP.wait(2)
            continue
        try:
            from huggingface_hub import hf_hub_download
            MODEL_ERROR = None
            MODEL_STAGE = "Đang tải DeepSeek 32B Q4 (~20 GB, lần đầu); dùng lại cache ở lần sau"
            model = hf_hub_download(repo_id="bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF", filename="DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf", revision=os.getenv("ARENA_MODEL_REVISION", "main"), cache_dir=str(ROOT / ".arena/models"))
            MODEL_FINGERPRINT = hashlib.sha256((Path(model).parent.name + ":DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf:b5046:" + os.getenv("ARENA_CONTEXT_SIZE", "4096") + ":0.6:0.95").encode()).hexdigest()
            policy = manifest()
            with MODEL_LOCK:
                if STOP.is_set() or not MODEL_ENABLED.is_set() or not policy.get("active") or not policy.get("llmEnabled"):
                    continue
                MODEL_STAGE = "Đang nạp DeepSeek lên GPU"
                with (ROOT / ".arena/llama.log").open("a") as log:
                    MODEL_PROCESS = subprocess.Popen(["/opt/arena/llama-server", "--model", model, "--host", "127.0.0.1", "--port", "8080", "--n-gpu-layers", "99", "--ctx-size", os.getenv("ARENA_CONTEXT_SIZE", "4096"), "--parallel", "1", "--threads", "8"], stdout=log, stderr=log)
            STOP.wait(5)
            if MODEL_PROCESS is not None and MODEL_PROCESS.poll() is not None and MODEL_ENABLED.is_set():
                raise RuntimeError("llama-server exited")
        except Exception:
            MODEL_ERROR = "DeepSeek chưa tải/khởi động được; tự thử lại sau 30 giây. Log: .arena/llama.log"
            MODEL_STAGE = MODEL_ERROR
            STOP.wait(30)

def policy_watchdog():
    while not STOP.is_set():
        if MODEL_ENABLED.is_set() and (time.time() >= POLICY_EXPIRES_AT or
                (PUBLIC_ENDS_AT and time.time() * 1000 >= PUBLIC_ENDS_AT)):
            MODEL_ENABLED.clear()
            STATE["chatLocked"] = True
            stop_model()
        STOP.wait(1)

@asynccontextmanager
async def lifespan(_app):
    (ROOT / ".arena").mkdir(parents=True, exist_ok=True)
    STOP.clear()
    for fn in (dataset_loop, *([model_worker, policy_watchdog] if HAS_LLM else [])):
        threading.Thread(target=fn, daemon=True).start()
    queue_task = asyncio.create_task(queue_loop()) if HAS_LLM else None
    yield
    STOP.set()
    if queue_task:
        queue_task.cancel()
        try:
            await queue_task
        except asyncio.CancelledError:
            pass
    MODEL_ENABLED.clear()
    if MODEL_PROCESS is not None:
        MODEL_PROCESS.terminate()

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, dependencies=[Depends(auth)])
class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=96000)
class CountRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=100)
class GenerateRequest(CountRequest):
    maxTokens: int = Field(ge=1, le=4096)
    expectedInputTokens: int = Field(ge=1, le=8192)
    runId: str | None = None

async def tokenize(messages):
    async with httpx.AsyncClient(timeout=15) as client:
        formatted = await client.post(LLAMA_URL + "/apply-template", json={"messages": [m.model_dump() for m in messages]})
        formatted.raise_for_status()
        response = await client.post(LLAMA_URL + "/tokenize", json={"content": formatted.json()["prompt"], "add_special": True})
        response.raise_for_status()
        return response.json()["tokens"]

@app.get("/health")
async def health():
    async with httpx.AsyncClient(timeout=2) as client:
        async def probe(url, headers=None, lab=False):
            try:
                response = await client.get(url, headers=headers)
                return response.status_code == 200 and (not lab or "jupyter-config-data" in response.text)
            except httpx.HTTPError:
                return False
        llm, jupyter = await asyncio.gather(probe(LLAMA_URL + "/health") if HAS_LLM else asyncio.sleep(0,result=False), probe("http://127.0.0.1:8888/lab", {"Authorization": "token " + os.environ["JUPYTER_TOKEN"]}, lab=True) if HAS_JUPYTER else asyncio.sleep(0,result=False))
    gpu = ""
    try:
        gpu = subprocess.check_output(["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu", "--format=csv,noheader,nounits"], timeout=3, text=True).strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return {**STATE, "chatQueueProtocol": 1, "modelFingerprint": MODEL_FINGERPRINT, "services": SERVICES, "llm": llm, "jupyter": jupyter, "gpu": gpu, "modelStage": "DeepSeek sẵn sàng" if llm else MODEL_STAGE, "error": (MODEL_ERROR if MODEL_ENABLED.is_set() else None) or STATE["error"]}

@app.post("/token-count")
async def token_count(request: CountRequest):
    if not HAS_LLM:
        raise HTTPException(404, "LLM not enabled")
    try:
        return {"count": len(await tokenize(request.messages))}
    except httpx.HTTPError:
        raise HTTPException(503, "Model not ready")

@app.post("/generate")
async def generate(request: GenerateRequest):
    if not HAS_LLM:
        raise HTTPException(404, "LLM not enabled")
    if GENERATING.locked():
        raise HTTPException(409, "GPU busy")
    async with GENERATING:
        try:
            policy = await asyncio.to_thread(manifest)
            if not policy.get("active") or not policy.get("llmEnabled"):
                raise HTTPException(403, "Chatbot locked")
            if request.runId and request.runId != policy.get("runId"):
                raise HTTPException(403, "Round changed")
            tokens = await tokenize(request.messages)
            if len(tokens) != request.expectedInputTokens:
                raise HTTPException(422, "Token count mismatch")
            async with httpx.AsyncClient(timeout=230) as client:
                response = await client.post(LLAMA_URL + "/completion", json={"prompt": tokens, "n_predict": request.maxTokens, "temperature": 0.6, "top_p": 0.95, "cache_prompt": False, "stream": False})
                response.raise_for_status()
                result = response.json()
            return {"content": result["content"], "inputTokens": len(tokens), "outputTokens": result["tokens_predicted"]}
        except httpx.HTTPError:
            raise HTTPException(503, "Model unavailable")


def journal_write(value):
    path = ROOT / ".arena" / "chat-job.json"
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value), encoding="utf-8")
    temp.chmod(0o600)
    temp.replace(path)


async def worker_call(action, job=None, **extra):
    body = {"workspaceId": os.environ["ARENA_WORKSPACE_ID"], "protocol": 1,
            "ready": MODEL_ENABLED.is_set() and bool(MODEL_FINGERPRINT),
            "fingerprint": MODEL_FINGERPRINT}
    if job:
        body.update(requestId=job["requestId"], attempt=job["attempt"])
    body.update(extra)
    url = os.environ["ARENA_CONTROL_URL"].rsplit("/manifest", 1)[0] + "/worker/" + action
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        response = await client.post(url, json=body, headers={"Authorization": "Bearer " + os.environ["ARENA_AGENT_TOKEN"]})
        response.raise_for_status()
        return response.json()


async def trim_job(job):
    messages = [Message(**m) for m in job["messages"]]
    template = job["template"]
    total_left = template["sessionTokenLimit"] - job["inputTokens"] - job["outputTokens"]
    input_left = template["inputTokenLimit"] - (job["inputTokens"] if template.get("tokenLimitMode") == "session" else 0)
    cap = min(input_left, total_left - 1, job["contextWindowTokens"] - 129)
    while True:
        # /apply-template only receives bounded exchanges, not the entire transcript.
        while len(messages) > 100:
            next_user = next((i for i in range(1, len(messages)) if messages[i].role == "user"), len(messages) - 1)
            messages = messages[next_user:]
        tokens = await tokenize(messages)
        if len(tokens) <= cap or len(messages) == 1:
            return messages, len(tokens)
        next_user = next((i for i in range(1, len(messages)) if messages[i].role == "user"), len(messages) - 1)
        messages = messages[next_user:]


async def queue_heartbeat(job):
    while not STOP.is_set():
        await asyncio.sleep(10)
        try:
            result = await worker_call("heartbeat", job)
            if not result.get("open") or result.get("runId") != job["runId"]:
                await asyncio.to_thread(stop_model)
                return
        except httpx.HTTPError:
            if time.time() >= POLICY_EXPIRES_AT or (PUBLIC_ENDS_AT and time.time() * 1000 >= PUBLIC_ENDS_AT):
                await asyncio.to_thread(stop_model)
                return


async def queue_loop():
    path = ROOT / ".arena" / "chat-job.json"
    while not STOP.is_set():
        try:
            if path.exists():
                saved = json.loads(path.read_text(encoding="utf-8"))
                # On restart, only resend a saved result. Never restart uncertain inference.
                result = await worker_call("complete" if saved.get("result") else "fail", saved["job"], **saved.get("result", {}))
                if result.get("terminal"):
                    path.unlink(missing_ok=True)
                else:
                    await asyncio.sleep(2)
                continue
            ready = False
            if MODEL_ENABLED.is_set() and MODEL_FINGERPRINT:
                async with httpx.AsyncClient(timeout=2) as client:
                    ready = (await client.get(LLAMA_URL + "/health")).status_code == 200
            result = await worker_call("claim", ready=ready)
            job = result.get("job")
            if not job:
                await asyncio.sleep(2 if ready else 10)
                continue
            journal_write({"job": {k: job[k] for k in ("requestId", "attempt", "runId")}})
            heartbeat = asyncio.create_task(queue_heartbeat(job))
            try:
                messages, count = await trim_job(job)
                prepared = await worker_call("prepare", job, promptTokens=count)
                if not prepared.get("execute"):
                    path.unlink(missing_ok=True)
                    continue
                try:
                    out = await generate(GenerateRequest(messages=messages, maxTokens=prepared["maxTokens"], expectedInputTokens=count, runId=job["runId"]))
                    journal_write({"job": {k: job[k] for k in ("requestId", "attempt", "runId")}, "result": out})
                except (httpx.HTTPError, HTTPException, ValueError, KeyError):
                    # The next iteration reports failure without running inference again.
                    pass
            finally:
                heartbeat.cancel()
                try:
                    await heartbeat
                except asyncio.CancelledError:
                    pass
        except httpx.HTTPStatusError as error:
            if path.exists() and error.response.status_code in (401, 403, 404, 409):
                # Fenced/retired worker: the server will reject its late result.
                path.unlink(missing_ok=True)
            elif path.exists() and error.response.status_code == 422:
                try:
                    saved = json.loads(path.read_text(encoding="utf-8"))
                    if (await worker_call("fail", saved["job"])).get("terminal"):
                        path.unlink(missing_ok=True)
                except httpx.HTTPError:
                    pass
            await asyncio.sleep(5)
        except (httpx.HTTPError, OSError, ValueError, KeyError):
            await asyncio.sleep(5)
