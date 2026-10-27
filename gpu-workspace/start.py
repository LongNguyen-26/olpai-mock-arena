"""Start only the requested services. Never execute contestant notebooks."""
import os
import signal
import subprocess
import time
from pathlib import Path


def launch_plan(root: Path, services: str):
    if services not in ("both", "llm", "jupyter"):
        raise ValueError("Invalid workspace services")
    commands = [["uvicorn", "agent:app", "--host=0.0.0.0", "--port=8000", "--app-dir=/opt/arena", "--no-access-log"]]
    if services == "llm":
        return commands
    if not os.environ.get("JUPYTER_TOKEN"):
        raise ValueError("Jupyter token required")
    for name in ("data/public", "data/private", "Final/Tac_vu_1", "Final/Tac_vu_2"):
        (root / name).mkdir(parents=True, exist_ok=True)
    (root / "data/private/PRIVATE_LOCKED.txt").write_text("Private chỉ được nạp sau khi vòng luyện mở private.\n", encoding="utf-8")
    config_dir = root / ".arena" / "jupyter"
    config_dir.mkdir(parents=True, exist_ok=True)
    # Expose only minimal readiness; authenticated status keeps Jupyter's schema.
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
c.ServerApp.trust_xheaders = True
pod_id = os.environ.get("RUNPOD_POD_ID")
if pod_id:
    c.ServerApp.allow_origin = "https://" + pod_id + "-8888.proxy.runpod.net"
''', encoding="utf-8")
    os.environ["PYTHONPATH"] = str(config_dir) + os.pathsep + os.environ.get("PYTHONPATH", "")
    commands.insert(0, ["jupyter", "lab", "--config=" + str(config), "--ip=0.0.0.0", "--port=8888", "--no-browser", "--allow-root", "--ServerApp.root_dir=" + str(root)])
    return commands


def main():
    root = Path(os.getenv("ARENA_WORKSPACE_ROOT", "/workspace"))
    (root / ".arena").mkdir(parents=True, exist_ok=True)
    commands = launch_plan(root, os.getenv("ARENA_WORKSPACE_SERVICES", "both"))
    processes = [subprocess.Popen(command) for command in commands]

    def stop(*_):
        for process in processes:
            if process.poll() is None:
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
                process.wait()


if __name__ == "__main__":
    main()
