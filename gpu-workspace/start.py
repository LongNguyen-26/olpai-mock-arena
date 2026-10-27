"""Runpod image supervisor. No contestant notebook is executed automatically."""
import os
import signal
import subprocess
import time
from pathlib import Path

root = Path("/workspace")
root.mkdir(parents=True, exist_ok=True)
for name in ("data/public", "data/private", "Final/Tac_vu_1", "Final/Tac_vu_2", ".arena"):
    (root / name).mkdir(parents=True, exist_ok=True)
lock_note = root / "data/private/PRIVATE_LOCKED.txt"
lock_note.write_text("Private chưa mở. Agent chỉ tải và giải nén sau khi server xác nhận pha private.\n", encoding="utf-8")
token = os.environ["JUPYTER_TOKEN"]
# Kept out of argv and notebook files. Training mode intentionally allows terminal access.
os.environ["JUPYTER_TOKEN"] = token
# Runpod probes /api/status without credentials. Expose only this minimal
# readiness response; Lab, files, terminals and kernels still require the token.
config_dir = root / ".arena" / "jupyter"
config_dir.mkdir(parents=True, exist_ok=True)
(config_dir / "arena_readiness.py").write_text('''from jupyter_server.services.api.handlers import APIStatusHandler
from jupyter_server.auth.decorator import allow_unauthenticated
class ReadyHandler(APIStatusHandler):
    @allow_unauthenticated
    async def get(self):
        self.set_header("Cache-Control", "no-store")
        if self.current_user:
            await super().get()
        else:
            self.finish({"status": "ok"})
default_handlers = [(r"/api/status", ReadyHandler)]
''', encoding="utf-8")
config = config_dir / "jupyter_server_config.py"
config.write_text('''import os
c.ServerApp.extra_services = ["arena_readiness"]
c.IdentityProvider.token = os.environ["JUPYTER_TOKEN"]
c.ServerApp.allow_remote_access = True
''', encoding="utf-8")
os.environ["PYTHONPATH"] = str(config_dir) + os.pathsep + os.environ.get("PYTHONPATH", "")
processes = [
    subprocess.Popen(["jupyter", "lab", "--config=" + str(config), "--ip=0.0.0.0", "--port=8888", "--no-browser", "--allow-root", "--ServerApp.root_dir=/workspace"]),
    subprocess.Popen(["uvicorn", "agent:app", "--host=0.0.0.0", "--port=8000", "--app-dir=/opt/arena", "--no-access-log"]),
]
def stop(*_):
    for process in processes:
        process.terminate()
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    while all(p.poll() is None for p in processes):
        time.sleep(1)
finally:
    stop()
    for process in processes:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
