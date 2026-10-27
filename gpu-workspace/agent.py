"""Trusted web control plane -> team Pod. LLM stays on localhost and shares GPU 0."""
import asyncio
import hashlib
import hmac
import json
import os
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
STATE = {"stage": "Khởi động", "publicReady": False, "privateReady": False, "error": None}
MODEL_PROCESS = None
MODEL_ERROR = None
MODEL_LOCK = threading.Lock()
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

async def auth(authorization: str | None = Header(default=None)):
    expected = "Bearer " + os.environ["ARENA_AGENT_TOKEN"]
    if not hmac.compare_digest(authorization or "", expected):
        raise HTTPException(401, "Unauthorized")

def manifest():
    with httpx.Client(timeout=30, follow_redirects=False) as client:
        response = client.get(os.environ["ARENA_CONTROL_URL"], params={"id": os.environ["ARENA_WORKSPACE_ID"]}, headers={"Authorization": "Bearer " + os.environ["ARENA_AGENT_TOKEN"]})
        response.raise_for_status()
        return response.json()

def safe_extract(archive: Path, destination: Path):
    """Reject ZIP traversal, symlinks and archives exceeding the extraction budget."""
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if sum(m.file_size for m in members) > 50 * 1024**3:
            raise ValueError("Archive too large")
        for member in members:
            path = PurePosixPath(member.filename.replace("\\", "/"))
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
    destination = ROOT / "data" / asset["phase"]
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
            safe_extract(temp, destination)
        shutil.move(str(temp), str(destination / name))
        marker.write_text(json.dumps({"sha256": asset["sha256"]}))
    finally:
        temp.unlink(missing_ok=True)

def dataset_loop():
    while not STOP.is_set():
        try:
            policy = manifest()
            STATE["chatLocked"] = not policy.get("llmEnabled", False)
            if not policy.get("active"):
                stop_model()
                STATE.update(publicReady=False, privateReady=False, stage="Lượt thi đã đóng hoặc được đặt lại")
                STOP.wait(20)
                continue
            if policy.get("phase") in ("private", "ended"):
                stop_model()
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
            # Never leak a signed URL, request header, or provider exception to the browser/log.
            STATE["error"] = "Chưa nạp được dataset. Agent sẽ thử lại; kiểm tra link Drive, checksum và dung lượng."
        STOP.wait(20)

def model_worker():
    global MODEL_PROCESS, MODEL_ERROR
    try:
        from huggingface_hub import hf_hub_download
        model = hf_hub_download(repo_id="bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF", filename="DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf", revision=os.getenv("ARENA_MODEL_REVISION", "main"), cache_dir=str(ROOT / ".arena/models"))
        log = (ROOT / ".arena/llama.log").open("a")
        with MODEL_LOCK:
            policy = manifest()
            if STOP.is_set() or not policy.get("active") or policy.get("phase") in ("private", "ended"):
                return
            MODEL_PROCESS = subprocess.Popen(["/opt/arena/llama-server", "--model", model, "--host", "127.0.0.1", "--port", "8080", "--n-gpu-layers", "99", "--ctx-size", os.getenv("ARENA_CONTEXT_SIZE", "4096"), "--parallel", "1", "--threads", "8"], stdout=log, stderr=log)
    except Exception:
        MODEL_ERROR = "Chưa tải/khởi động được model; xem log Pod."

@asynccontextmanager
async def lifespan(_app):
    (ROOT / ".arena").mkdir(parents=True, exist_ok=True)
    STOP.clear()
    for fn in (dataset_loop, model_worker):
        threading.Thread(target=fn, daemon=True).start()
    yield
    STOP.set()
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
        async def probe(url):
            try:
                return (await client.get(url)).status_code == 200
            except httpx.HTTPError:
                return False
        llm, jupyter = await asyncio.gather(probe(LLAMA_URL + "/health"), probe("http://127.0.0.1:8888/login"))
    gpu = ""
    try:
        gpu = subprocess.check_output(["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader"], timeout=3, text=True).strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return {**STATE, "llm": llm, "jupyter": jupyter, "gpu": gpu, "error": MODEL_ERROR or STATE["error"]}

@app.post("/token-count")
async def token_count(request: CountRequest):
    try:
        return {"count": len(await tokenize(request.messages))}
    except httpx.HTTPError:
        raise HTTPException(503, "Model not ready")

@app.post("/generate")
async def generate(request: GenerateRequest):
    if GENERATING.locked():
        raise HTTPException(409, "GPU busy")
    async with GENERATING:
        try:
            policy = await asyncio.to_thread(manifest)
            if not policy.get("active") or not policy.get("llmEnabled"):
                raise HTTPException(403, "Chatbot locked")
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
