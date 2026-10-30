"""Start only the requested services. Never execute contestant notebooks."""
import os
import json
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
    if os.getenv("ARENA_JUPYTER_MODE", "single") == "team-hub":
        if services != "jupyter":
            raise ValueError("Team Hub requires Jupyter-only")
        from hub_runtime import HubManager
        manager = HubManager(root)
        manager.check_privileges()
        for team_id in list(manager.users):
            manager.ensure_user(team_id)
        commands.insert(0, ["/opt/arena/hub-venv/bin/jupyterhub", "--config=/opt/arena/hub_config.py"])
        return commands
    if not os.environ.get("JUPYTER_TOKEN"):
        raise ValueError("Jupyter token required")
    config_dir = root / ".arena" / "jupyter"
    config_dir.mkdir(parents=True, exist_ok=True)
    # The dependency image also contains RTC for Hub. Preserve the legacy Lab
    # drive/executor when starting a single server without the RTC backend.
    labconfig = config_dir / "labconfig"
    labconfig.mkdir(exist_ok=True)
    (labconfig / "page_config.json").write_text(json.dumps({"disabledExtensions": {
        "@jupyter/docprovider-extension": True,
        "@jupyter/collaboration-extension": True,
        "@jupyterlab/filebrowser-extension:defaultFileBrowser": False,
        "@jupyterlab/notebook-extension:cell-executor": False,
    }}), encoding="utf-8")
    os.environ["JUPYTER_CONFIG_PATH"] = str(config_dir) + os.pathsep + os.environ.get("JUPYTER_CONFIG_PATH", "")
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
c.ServerApp.jpserver_extensions = {"jupyter_server_ydoc": False}
pod_id = os.environ.get("RUNPOD_POD_ID")
if pod_id:
    c.ServerApp.allow_origin = "https://" + pod_id + "-8888.proxy.runpod.net"
''', encoding="utf-8")
    os.environ["PYTHONPATH"] = str(config_dir) + os.pathsep + os.environ.get("PYTHONPATH", "")
    commands.insert(0, ["jupyter", "lab", "--config=" + str(config), "--ip=0.0.0.0", "--port=8888", "--no-browser", "--allow-root", "--ServerApp.root_dir=" + str(root)])
    return commands


def main():
    root = Path(os.getenv("ARENA_WORKSPACE_ROOT", "/workspace"))
    prepare_root(root)
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


def prepare_root(root):
    # launch_plan and HubManager must never inherit a public directory created
    # here: some NFS implementations do not apply chmod after mkdir.
    (root / ".arena").mkdir(mode=0o700, parents=True, exist_ok=True)


if __name__ == "__main__":
    main()
