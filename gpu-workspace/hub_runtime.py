"""Root-only Hub provisioning. Notebook code is never executed by this module."""
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
from pathlib import Path

import httpx

PROTOCOL = 1
TEAM_ID = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")


def username(team_id):
    if not TEAM_ID.fullmatch(team_id):
        raise ValueError("Invalid team ID")
    return "t" + team_id.replace("-", "")[:24]


def atomic_json(path, value):
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(value), encoding="utf-8")
    temp.chmod(0o600)
    temp.replace(path)


def resources(root):
    available = None
    try:
        values = {line.split(":")[0]: int(line.split()[1]) * 1024
                  for line in Path("/proc/meminfo").read_text().splitlines()}
        available_bytes = values["MemAvailable"]
        # /proc/meminfo can describe the physical host, rather than the Pod.
        for base, limit_name, used_name in ((Path("/sys/fs/cgroup"), "memory.max", "memory.current"),
                                           (Path("/sys/fs/cgroup/memory"), "memory.limit_in_bytes", "memory.usage_in_bytes")):
            try:
                limit = (base / limit_name).read_text().strip()
                if limit != "max":
                    available_bytes = min(available_bytes, max(0, int(limit) - int((base / used_name).read_text())))
            except (OSError, ValueError):
                pass
        available = available_bytes / 1024**3
    except (OSError, ValueError, KeyError):
        pass
    return {"availableRAMGiB": available, "freeDiskGiB": shutil.disk_usage(root).free / 1024**3}


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("Unsafe control directory")
    path.chmod(0o700)


def link_or_copy(source, target):
    try:
        os.link(source, target)
        return target
    except OSError:
        return shutil.copy2(source, target)


class TeamFiles:
    """Use directory FDs and O_NOFOLLOW for every write into a writable home."""
    def __init__(self, home, uid, gid):
        self.home, self.uid, self.gid = Path(home), uid, gid

    def parent(self, parts):
        fd = os.open(self.home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in parts:
                if part in ("", ".", "..") or "/" in part:
                    raise ValueError("Unsafe destination")
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.fchown(child, self.uid, self.gid)
                os.close(fd)
                fd = child
            return fd
        except BaseException:
            os.close(fd)
            raise

    def install(self, relative, source, link=False):
        parts = Path(relative).parts
        fd = self.parent(parts[:-1])
        try:
            if link:
                try:
                    os.symlink(str(source), parts[-1], dir_fd=fd)
                except FileExistsError:
                    pass
            else:
                try:
                    target = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                except FileExistsError:
                    return
                with os.fdopen(target, "wb") as output, Path(source).open("rb") as incoming:
                    shutil.copyfileobj(incoming, output)
                    os.fchown(output.fileno(), self.uid, self.gid)
        finally:
            os.close(fd)


class HubManager:
    def __init__(self, root):
        self.root = Path(root)
        self.root.chmod(0o755)
        self.control = self.root / ".arena" / "hub"
        private_directory(self.root / ".arena")
        private_directory(self.control)
        self.teams_root = self.root / "teams"
        self.shared = self.root / "datasets"
        for path in (self.teams_root, self.shared):
            if path.is_symlink():
                raise ValueError("Unsafe root")
            path.mkdir(exist_ok=True)
            path.chmod(0o755)
        self.guard = threading.RLock()
        self.users = self._read("users.json", {})
        self.published = self._read("assets.json", {})
        for name in ("service-token", "cookie-secret", "proxy-token"):
            path = self.control / name
            if not path.exists():
                path.write_text(secrets.token_hex(32))
            path.chmod(0o600)

    def _read(self, name, default):
        path = self.control / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default

    def check_privileges(self):
        if os.geteuid() != 0:
            raise RuntimeError("JupyterHub needs root to switch to team UIDs")
        # A child proves setgroups/setgid/setuid work, without altering the agent.
        subprocess.run([os.getenv("ARENA_SYSTEM_PYTHON", "/usr/bin/python3"), "-c", "import os; os.setgroups([]); os.setgid(65534); os.setuid(65534); assert os.geteuid()==65534"], check=True, timeout=10)

    def ensure_user(self, team_id):
        import pwd
        import grp
        name = username(team_id)
        with self.guard:
            old = self.users.get(team_id)
            if old is None:
                used = {v["uid"] for v in self.users.values()} | {v.pw_uid for v in pwd.getpwall()} | {v.gr_gid for v in grp.getgrall()}
                uid = next(i for i in range(10000, 60000) if i not in used)
                if any(v["name"] == name for v in self.users.values()):
                    raise RuntimeError("Team username collision")
                old = {"name": name, "uid": uid}
                self.users[team_id] = old
                atomic_json(self.control / "users.json", self.users)
            try:
                account = pwd.getpwnam(name)
                if account.pw_uid != old["uid"] or account.pw_gid != old["uid"] or account.pw_dir != str(self.teams_root / team_id):
                    raise RuntimeError("Team UID mismatch")
            except KeyError:
                try:
                    group = grp.getgrnam(name)
                    if group.gr_gid != old["uid"]:
                        raise RuntimeError("Team GID mismatch")
                except KeyError:
                    subprocess.run(["groupadd", "--gid", str(old["uid"]), name], check=True, timeout=10)
                subprocess.run(["useradd", "--uid", str(old["uid"]), "--gid", str(old["uid"]), "--home-dir", str(self.teams_root / team_id), "--shell", "/bin/bash", "--no-create-home", "--no-log-init", name], check=True, timeout=10)
            home = self.teams_root / team_id
            if home.is_symlink():
                raise ValueError("Unsafe home")
            home.mkdir(mode=0o700, exist_ok=True)
            home.chmod(0o700)
            os.chown(home, old["uid"], old["uid"])
            files = TeamFiles(home, old["uid"], old["uid"])
            # Directory FDs reject contestant-controlled symlinks before use.
            fd = files.parent((".venvs",)); os.close(fd)
            venv = home / ".venvs" / "pytorch"
            if not (venv / "bin/python").exists():
                clean = {"HOME": str(home), "USER": name, "PATH": "/usr/bin:/bin"}
                script = "import venv,pathlib,sys; p=pathlib.Path(sys.argv[1]); venv.create(p,system_site_packages=True,with_pip=True); site=next(p.glob('lib/python*/site-packages')); (site/'arena-base.pth').write_text('/opt/arena/venv/lib/python3.10/site-packages\\n')"
                # All writes in the virtualenv run as the team, including .pth.
                subprocess.run([os.getenv("ARENA_SYSTEM_PYTHON", "/usr/bin/python3"), "-c", script, str(venv)], env=clean, user=old["uid"], group=old["uid"], extra_groups=[], check=True, timeout=90)
            kernel = self.control / (name + "-kernel.json")
            atomic_json(kernel, {"argv": [str(venv / "bin/python"), "-m", "ipykernel_launcher", "-f", "{connection_file}"], "display_name": "Python (PyTorch · riêng đội)", "language": "python"})
            files.install(".local/share/jupyter/kernels/pytorch/kernel.json", kernel)
            return {**old, "home": str(home)}

    def cache_asset(self, asset, load, current_policy):
        digest = asset["sha256"]
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid checksum")
        if digest in self.published:
            return
        source = self.control / "objects" / digest
        source.mkdir(parents=True, exist_ok=True)
        load(asset, source)
        # Recheck the live gate after potentially long downloads.
        latest = current_policy()
        if not latest.get("active") or not any(a.get("sha256") == digest for a in latest.get("assets", [])):
            return
        target = self.shared / digest
        if not target.exists():
            staging = self.control / (digest + "-publish")
            if staging.exists():
                shutil.rmtree(staging)
            staging.mkdir()
            if asset.get("workspaceLayout") == "task-root":
                for task in source.glob("Tac_vu_*"):
                    data = task / "dataset"
                    if data.is_dir():
                        shutil.copytree(data, staging / task.name / "dataset", copy_function=link_or_copy)
            else:
                shutil.copytree(source / "data" / asset["phase"], staging / "data" / asset["phase"], copy_function=link_or_copy)
            for path in staging.rglob("*"):
                if path.is_symlink():
                    raise ValueError("Unsafe staged dataset")
                path.chmod(0o755 if path.is_dir() else 0o444)
            staging.chmod(0o755)
            staging.replace(target)
        with self.guard:
            self.published[digest] = {"phase": asset["phase"], "taskRoot": asset.get("workspaceLayout") == "task-root"}
            atomic_json(self.control / "assets.json", self.published)

    def install_assets(self, team_id, policy):
        user = self.ensure_user(team_id)
        files = TeamFiles(user["home"], user["uid"], user["uid"])
        public_ready, private_ready = True, not policy.get("privateLocked", True)
        for asset in policy.get("assets", []):
            digest = asset["sha256"]
            if digest not in self.published:
                public_ready &= asset["phase"] != "public"
                private_ready &= asset["phase"] != "private"
                continue
            source, shared = self.control / "objects" / digest, self.shared / digest
            if self.published[digest]["taskRoot"]:
                for task in source.glob("Tac_vu_*"):
                    for item in task.rglob("*"):
                        rel = item.relative_to(source)
                        if "dataset" in rel.parts or not item.is_file():
                            continue
                        files.install(rel, item)
                    data = shared / task.name / "dataset"
                    if data.exists():
                        for item in data.iterdir():
                            files.install(Path(task.name) / "dataset" / item.name, item, link=True)
            else:
                data = shared / "data" / asset["phase"]
                for item in data.iterdir():
                    files.install(Path("data") / asset["phase"] / item.name, item, link=True)
        return public_ready, private_ready

    def hub_request(self, method, path):
        token = (self.control / "service-token").read_text().strip()
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            response = client.request(method, "http://127.0.0.1:8081/hub/api" + path,
                                      headers={"Authorization": "token " + token})
            if response.status_code == 404 and method == "GET":
                return None
            response.raise_for_status()
            return response.json() if response.content else {}

    def reconcile(self, policy):
        atomic_json(self.control / "policy.json", policy)
        measured = resources(self.root)
        users = self.hub_request("GET", "/users")
        online = {u["name"]: u for u in users}
        active = sum(bool(u.get("servers")) for u in users)
        pending = sum(bool(u.get("pending")) for u in users)
        reports = []
        for team in policy["hub"]["teams"]:
            name = username(team["teamId"])
            observed = online.get(name, {})
            server = observed.get("servers", {}).get("", {})
            report = {"teamId": team["teamId"], "revision": team["revision"], "state": "stopped", "publicReady": False, "privateReady": False}
            try:
                if not team["enabled"] or team["desiredState"] == "stopped":
                    if server:
                        self.hub_request("DELETE", "/users/" + name + "/server")
                    reports.append(report)
                    continue
                if server.get("ready"):
                    report["publicReady"], report["privateReady"] = self.install_assets(team["teamId"], policy)
                    report["state"] = "ready"
                elif server or observed.get("pending"):
                    report["state"] = "starting"
                elif active >= policy["hub"].get("maxTeamServers", 7) or pending >= 2 or measured["availableRAMGiB"] is None or measured["availableRAMGiB"] < 4 or measured["freeDiskGiB"] < 2:
                    report["state"] = "waiting-resource"
                else:
                    self.ensure_user(team["teamId"])
                    report["publicReady"], report["privateReady"] = self.install_assets(team["teamId"], policy)
                    if not observed:
                        self.hub_request("POST", "/users/" + name)
                    self.hub_request("POST", "/users/" + name + "/server")
                    active += 1; pending += 1
                    report["state"] = "starting"
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, httpx.HTTPError):
                report.update(state="error", error="Không chuẩn bị được workspace. Admin kiểm tra tài nguyên và quyền runtime.")
            reports.append(report)
        return {"runId": policy["runId"], "hubReady": True, "resources": measured, "notebooks": reports}
