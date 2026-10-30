"""Proxy on 8888; Hub API and proxy API remain on localhost."""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

# Traitlets executes this config without adding its directory to sys.path.
# The controller CLI runs from hub-venv/bin, separately from start.py.
# Resolve only the root-owned modules bundled in the image, not workspace files.
sys.path.insert(0, "/opt/arena")

from jupyterhub.spawner import LocalProcessSpawner
from hub_auth import ArenaAuthenticator
from hub_runtime import resources, username

root = Path(os.getenv("ARENA_WORKSPACE_ROOT", "/workspace"))
control = root / ".arena" / "hub"
spawn_slots = asyncio.Semaphore(2)


class TeamSpawner(LocalProcessSpawner):
    async def stop(self, now=False):
        await super().stop(now=now)
        users = json.loads((control / "users.json").read_text())
        uid = next((v["uid"] for v in users.values() if v["name"] == self.user.name), None)
        if uid is not None and 10000 <= uid < 60000:
            # UID belongs to exactly one team; stop terminal/background jobs too.
            subprocess.run(["pkill", "-TERM", "-u", str(uid)], check=False)
            await asyncio.sleep(1)
            subprocess.run(["pkill", "-KILL", "-u", str(uid)], check=False)

    def get_env(self):
        original = super().get_env()
        env = {k: v for k, v in original.items() if k.startswith("JUPYTERHUB_")}
        users = json.loads((control / "users.json").read_text())
        team_id = next(k for k, v in users.items() if v["name"] == self.user.name)
        home = str(root / "teams" / team_id)
        env.update(HOME=home, USER=self.user.name, LOGNAME=self.user.name, SHELL="/bin/bash",
                   PATH=home + "/.venvs/pytorch/bin:/opt/arena/venv/bin:/usr/local/bin:/usr/bin:/bin",
                   VIRTUAL_ENV=home + "/.venvs/pytorch",
                   OMP_NUM_THREADS="2", MKL_NUM_THREADS="2", OPENBLAS_NUM_THREADS="2",
                   JUPYTER_PREFER_ENV_PATH="0", JUPYTER_PATH=home + "/.local/share/jupyter:/opt/arena/venv/share/jupyter")
        for name in ("LD_LIBRARY_PATH", "NVIDIA_VISIBLE_DEVICES", "NVIDIA_DRIVER_CAPABILITIES", "CUDA_VISIBLE_DEVICES"):
            if name in os.environ:
                env[name] = os.environ[name]
        return env

    async def start(self):
        async with spawn_slots:
            policy = json.loads((control / "policy.json").read_text())
            team = next((t for t in policy.get("hub", {}).get("teams", []) if username(t["teamId"]) == self.user.name), None)
            if not policy.get("active") or not team or not team["enabled"] or team["desiredState"] != "running":
                raise RuntimeError("Workspace not authorized by Arena")
            measured = resources(root)
            if measured["availableRAMGiB"] is None or measured["availableRAMGiB"] < 4 or measured["freeDiskGiB"] < 2:
                raise RuntimeError("Waiting for RAM or storage")
            self.notebook_dir = str(root / "teams" / team["teamId"])
            kernel_dirs = [self.notebook_dir + "/.local/share/jupyter/kernels", "/opt/arena/venv/share/jupyter/kernels"]
            self.args = [arg for arg in self.args if not arg.startswith("--KernelSpecManager.kernel_dirs=")]
            self.args.append("--KernelSpecManager.kernel_dirs=" + json.dumps(kernel_dirs))
            return await super().start()


c = get_config()  # noqa: F821 - supplied by JupyterHub
c.JupyterHub.bind_url = "http://0.0.0.0:8888"
c.JupyterHub.hub_bind_url = "http://127.0.0.1:8081"
c.ConfigurableHTTPProxy.api_url = "http://127.0.0.1:8001"
c.ConfigurableHTTPProxy.auth_token = (control / "proxy-token").read_text().strip()
c.ConfigurableHTTPProxy.extra_routes = {"/api/status": "http://127.0.0.1:8000"}
c.ConfigurableHTTPProxy.command = ["configurable-http-proxy", "--log-level=error"]
c.JupyterHub.db_url = "sqlite:///" + str(control / "hub.sqlite")
c.JupyterHub.cookie_secret_file = str(control / "cookie-secret")
c.JupyterHub.authenticator_class = ArenaAuthenticator
c.JupyterHub.spawner_class = TeamSpawner
c.JupyterHub.active_server_limit = int(os.getenv("ARENA_MAX_TEAM_SERVERS", "7"))
c.JupyterHub.concurrent_spawn_limit = 2
c.JupyterHub.allow_named_servers = False
c.JupyterHub.admin_access = False
c.JupyterHub.services = [{"name": "arena-controller", "api_token": (control / "service-token").read_text().strip()}]
c.JupyterHub.load_roles = [{"name": "arena-control", "services": ["arena-controller"], "scopes": ["admin:users", "admin:servers", "read:hub"]}]
c.JupyterHub.cleanup_servers = True
c.JupyterHub.log_level = "ERROR"
c.JupyterHub.tornado_settings = {"log_function": lambda handler: None}
c.Spawner.cmd = ["/opt/arena/venv/bin/jupyterhub-singleuser"]
c.Spawner.default_url = "/lab"
# Team-local kernels/config are allowed for this trusted internal deployment.
# Hub configuration/secrets remain root-only; the process still drops to its UID.
c.Spawner.disable_user_config = False
c.Spawner.start_timeout = 120
c.Spawner.args = ["--ServerApp.allow_remote_access=True", "--ServerApp.trust_xheaders=True", "--MappingKernelManager.default_kernel_name=pytorch", "--KernelSpecManager.ensure_native_kernel=False"]
pod = os.getenv("RUNPOD_POD_ID")
if pod:
    public = "https://" + pod + "-8888.proxy.runpod.net"
    c.JupyterHub.public_url = public + "/"
    c.Spawner.args.append("--ServerApp.allow_origin=" + public)
elif os.getenv("ARENA_TEST_HTTP") == "1":
    c.JupyterHub.public_url = "http://127.0.0.1:8888/"
    c.Spawner.args.append("--ServerApp.allow_origin=http://127.0.0.1:8888")
