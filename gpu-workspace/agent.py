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
HUB_MODE = os.getenv("ARENA_JUPYTER_MODE", "single") == "team-hub"
HUB_MANAGER = None
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
LLM_PARALLEL = int(os.getenv("ARENA_LLM_PARALLEL", "1"))
CONTEXT_SIZE = int(os.getenv("ARENA_CONTEXT_SIZE", "4096"))
if LLM_PARALLEL not in (1, 2, 4, 8) or not 128 <= CONTEXT_SIZE <= 32768:
    raise ValueError("Invalid LLM capacity/context")
INFERENCE_SLOTS = set()
UNCONFIRMED_SLOTS = set()
ENGINE_READY = False
INFERENCE_TIMEOUT = 600


def model_command(model):
    # b5046 divides the total context across parallel sequences.
    return ["/opt/arena/llama-server", "--model", model, "--host", "127.0.0.1",
            "--port", "8080", "--n-gpu-layers", "99", "--ctx-size",
            str(CONTEXT_SIZE * LLM_PARALLEL), "--parallel", str(LLM_PARALLEL),
            "--cont-batching", "--slots", "--metrics", "--threads", "8"]


async def engine_slots():
    async with httpx.AsyncClient(timeout=2) as client:
        response = await client.get(LLAMA_URL + "/slots")
        response.raise_for_status()
        slots = response.json()
        if not isinstance(slots, list):
            raise ValueError("Invalid engine slots")
        return slots


async def engine_ready():
    global ENGINE_READY
    try:
        slots = await engine_slots()
        ENGINE_READY = all(any(s.get("id") == slot and s.get("n_ctx", 0) >= CONTEXT_SIZE
                                     for s in slots) for slot in range(LLM_PARALLEL))
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        ENGINE_READY = False
    return ENGINE_READY


async def engine_slot_idle(slot):
    if MODEL_PROCESS is not None and MODEL_PROCESS.poll() is not None:
        return True
    try:
        slots = await engine_slots()
        return any(s.get("id") == slot and s.get("is_processing") is False for s in slots)
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        # A failed probe does not prove that an earlier completion stopped.
        return False

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

def load_asset(asset: dict, root=None):
    root = ROOT if root is None else Path(root)
    name = asset["name"]
    if Path(name).name != name or "\\" in name or name in (".", ".."):
        raise ValueError("Invalid asset name")
    task_root = asset.get("workspaceLayout") == "task-root"
    destination = root if task_root else root / "data" / asset["phase"]
    destination.mkdir(parents=True, exist_ok=True)
    cache = root / ".arena" / "downloads"
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
                if HUB_MODE:
                    HUB_MANAGER.cache_asset(asset, None, manifest)
                else:
                    load_asset(asset)
            STATE["publicReady"] = True
            STATE["privateReady"] = not policy["privateLocked"]
            if STATE["privateReady"] and not HUB_MODE:
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
                    MODEL_PROCESS = subprocess.Popen(model_command(model), stdout=log, stderr=log)
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

def hub_loop():
    while not STOP.is_set():
        try:
            policy = manifest()
            if policy.get("active") and policy.get("hubProtocol") == 1 and "hub" in policy:
                report = HUB_MANAGER.reconcile(policy)
                report["id"] = os.environ["ARENA_WORKSPACE_ID"]
                control = os.environ["ARENA_CONTROL_URL"].rsplit("/manifest", 1)[0]
                with httpx.Client(timeout=15, follow_redirects=False) as client:
                    response = client.post(control + "/hub/report", json=report,
                                           headers={"Authorization": "Bearer " + os.environ["ARENA_AGENT_TOKEN"]})
                    response.raise_for_status()
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError, httpx.HTTPError):
            pass
        STOP.wait(5)


@asynccontextmanager
async def lifespan(_app):
    global HUB_MANAGER
    if not HUB_MODE:
        (ROOT / ".arena").mkdir(mode=0o700, parents=True, exist_ok=True)
    if HUB_MODE:
        if SERVICES != "jupyter":
            raise ValueError("Hub requires Jupyter-only")
        from hub_runtime import HubManager
        HUB_MANAGER = HubManager(ROOT)
        HUB_MANAGER.check_privileges()
    STOP.clear()
    for fn in (dataset_loop, *([hub_loop] if HUB_MODE else []), *([model_worker, policy_watchdog] if HAS_LLM else [])):
        threading.Thread(target=fn, daemon=True).start()
    queue_tasks = [asyncio.create_task(queue_loop(slot)) for slot in range(LLM_PARALLEL)] if HAS_LLM else []
    yield
    STOP.set()
    for task in queue_tasks:
        task.cancel()
    await asyncio.gather(*queue_tasks, return_exceptions=True)
    MODEL_ENABLED.clear()
    if MODEL_PROCESS is not None:
        MODEL_PROCESS.terminate()

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, dependencies=[Depends(auth)])
if HUB_MODE:
    from starlette.routing import Route
    from starlette.responses import JSONResponse
    async def proxy_readiness(_request):
        return JSONResponse({"status": "ok"})
    # The only unauthenticated route: minimal readiness through CHP on 8888.
    app.router.routes.insert(0, Route("/api/status", proxy_readiness, methods=["GET"]))

@app.get("/identity")
async def identity(challenge: str):
    if not re.fullmatch(r"[a-f0-9]{32}", challenge):
        raise HTTPException(400, "Invalid challenge")
    return {"workspaceId": os.environ.get("ARENA_WORKSPACE_ID"), "podId": os.environ.get("RUNPOD_POD_ID"),
            "services": SERVICES, "jupyterMode": "team-hub" if HUB_MODE else "single", "hubProtocol": 1 if HUB_MODE else 0, "challenge": challenge}
class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=96000)
class CountRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=100)
class GenerateRequest(CountRequest):
    maxTokens: int = Field(ge=1, le=4096)
    expectedInputTokens: int = Field(ge=1, le=8192)
    runId: str | None = None
    slot: int | None = Field(default=None, ge=0, le=7)

async def tokenize(messages):
    async with httpx.AsyncClient(timeout=15) as client:
        formatted = await client.post(LLAMA_URL + "/apply-template", json={"messages": [m.model_dump() for m in messages]})
        formatted.raise_for_status()
        response = await client.post(LLAMA_URL + "/tokenize", json={"content": formatted.json()["prompt"], "add_special": True})
        response.raise_for_status()
        return response.json()["tokens"]

@app.get("/health")
async def health():
    if HUB_MODE:
        ready = False
        try:
            await asyncio.to_thread(HUB_MANAGER.hub_request, "GET", "/info")
            ready = True
        except (AttributeError, OSError, ValueError, httpx.HTTPError):
            pass
        gpu = ""
        try:
            gpu = subprocess.check_output(["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu", "--format=csv,noheader,nounits"], timeout=3, text=True).strip()
        except (OSError, subprocess.SubprocessError):
            pass
        return {**STATE, "hubProtocol": 1, "hubReady": ready, "services": SERVICES, "jupyter": ready, "llm": False, "gpu": gpu}
    async with httpx.AsyncClient(timeout=2) as client:
        async def probe(url, headers=None, lab=False):
            try:
                response = await client.get(url, headers=headers)
                return response.status_code == 200 and (not lab or "jupyter-config-data" in response.text)
            except httpx.HTTPError:
                return False
        llm, jupyter = await asyncio.gather(engine_ready() if HAS_LLM else asyncio.sleep(0,result=False), probe("http://127.0.0.1:8888/lab", {"Authorization": "token " + os.environ["JUPYTER_TOKEN"]}, lab=True) if HAS_JUPYTER else asyncio.sleep(0,result=False))
    gpu = ""
    try:
        gpu = subprocess.check_output(["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu", "--format=csv,noheader,nounits"], timeout=3, text=True).strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return {**STATE, "chatQueueProtocol": 2, "llmParallel": LLM_PARALLEL if HAS_LLM else 0, "llmActiveSlots": len(INFERENCE_SLOTS | UNCONFIRMED_SLOTS), "modelFingerprint": MODEL_FINGERPRINT, "services": SERVICES, "llm": llm, "jupyter": jupyter, "gpu": gpu, "modelStage": "DeepSeek sẵn sàng" if llm else MODEL_STAGE, "error": (MODEL_ERROR if MODEL_ENABLED.is_set() else None) or STATE["error"]}

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
    for pending_slot in list(UNCONFIRMED_SLOTS):
        if await engine_slot_idle(pending_slot):
            UNCONFIRMED_SLOTS.discard(pending_slot)
    slot = request.slot if request.slot is not None else next((s for s in range(LLM_PARALLEL) if s not in INFERENCE_SLOTS and s not in UNCONFIRMED_SLOTS), None)
    if slot is None or slot >= LLM_PARALLEL or slot in INFERENCE_SLOTS or slot in UNCONFIRMED_SLOTS:
        raise HTTPException(409, "GPU busy")
    # No await between selecting and reserving a slot on this event loop.
    INFERENCE_SLOTS.add(slot)
    submitted = False
    try:
        try:
            policy = await asyncio.to_thread(manifest)
            if not policy.get("active") or not policy.get("llmEnabled"):
                raise HTTPException(403, "Chatbot locked")
            if request.runId and request.runId != policy.get("runId"):
                raise HTTPException(403, "Round changed")
            tokens = await tokenize(request.messages)
            if len(tokens) != request.expectedInputTokens:
                raise HTTPException(422, "Token count mismatch")
            async with httpx.AsyncClient(timeout=httpx.Timeout(INFERENCE_TIMEOUT, connect=10)) as client:
                submitted = True
                response = await client.post(LLAMA_URL + "/completion", json={"prompt": tokens, "id_slot": slot, "n_predict": request.maxTokens, "temperature": 0.6, "top_p": 0.95, "cache_prompt": False, "stream": False})
                response.raise_for_status()
                result = response.json()
                if not isinstance(result.get("content"), str) or not isinstance(result.get("tokens_predicted"), int) or not 0 <= result["tokens_predicted"] <= request.maxTokens:
                    raise ValueError("Invalid engine completion")
            return {"content": result["content"], "inputTokens": len(tokens), "outputTokens": result["tokens_predicted"]}
        except asyncio.CancelledError:
            if submitted:
                UNCONFIRMED_SLOTS.add(slot)
            raise
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            if submitted:
                UNCONFIRMED_SLOTS.add(slot)
            raise HTTPException(503, "Model unavailable")
    finally:
        INFERENCE_SLOTS.discard(slot)


def journal_path(slot):
    path = ROOT / ".arena" / "chat-jobs"
    path.mkdir(parents=True, exist_ok=True)
    return path / ("slot-" + str(slot) + ".json")


def journal_write(value, slot=0):
    path = journal_path(slot)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value), encoding="utf-8")
    temp.chmod(0o600)
    temp.replace(path)


async def worker_call(action, job=None, **extra):
    slot = extra.pop("slot", (job or {}).get("slot", 0))
    body = {"workspaceId": os.environ["ARENA_WORKSPACE_ID"], "protocol": 2,
            "slot": slot, "capacity": LLM_PARALLEL,
            "ready": MODEL_ENABLED.is_set() and ENGINE_READY,
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
                if MODEL_RUN_ID == job["runId"]:
                    await asyncio.to_thread(stop_model)
                return
        except httpx.HTTPError:
            if time.time() >= POLICY_EXPIRES_AT or (PUBLIC_ENDS_AT and time.time() * 1000 >= PUBLIC_ENDS_AT):
                await asyncio.to_thread(stop_model)
                return


async def queue_loop(slot=0):
    path = journal_path(slot)
    legacy = ROOT / ".arena" / "chat-job.json"
    while not STOP.is_set():
        try:
            if slot == 0 and legacy.exists() and not path.exists():
                legacy.replace(path)
            if path.exists():
                saved = json.loads(path.read_text(encoding="utf-8"))
                saved["job"]["slot"] = slot
                # On restart, only resend a saved result. Never restart uncertain inference.
                if not saved.get("result") and not await engine_slot_idle(slot):
                    await worker_call("heartbeat", saved["job"])
                    await asyncio.sleep(2)
                    continue
                UNCONFIRMED_SLOTS.discard(slot)
                result = await worker_call("complete" if saved.get("result") else "fail", saved["job"], **saved.get("result", {}))
                if result.get("terminal"):
                    path.unlink(missing_ok=True)
                else:
                    await asyncio.sleep(2)
                continue
            ready = False
            if MODEL_ENABLED.is_set() and MODEL_FINGERPRINT:
                ready = await engine_ready()
            result = await worker_call("claim", ready=ready, slot=slot)
            job = result.get("job")
            if not job:
                await asyncio.sleep(2 if ready else 10)
                continue
            job["slot"] = slot
            journal_write({"job": {k: job[k] for k in ("requestId", "attempt", "runId", "slot")}}, slot)
            heartbeat = asyncio.create_task(queue_heartbeat(job))
            try:
                messages, count = await trim_job(job)
                prepared = await worker_call("prepare", job, promptTokens=count)
                if not prepared.get("execute"):
                    path.unlink(missing_ok=True)
                    continue
                try:
                    out = await generate(GenerateRequest(messages=messages, maxTokens=prepared["maxTokens"], expectedInputTokens=count, runId=job["runId"], slot=slot))
                    journal_write({"job": {k: job[k] for k in ("requestId", "attempt", "runId", "slot")}, "result": out}, slot)
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
