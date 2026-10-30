"""Root-only Hub provisioning. Notebook code is never executed by this module."""
import json
import logging
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
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
    os.chown(path, 0, 0)
    path.chmod(0o700)
    info = path.stat()
    if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError("Control directory must be owned by root with mode 0700")


def runtime_directory():
    return Path(os.getenv("ARENA_HUB_RUNTIME_ROOT", "/run/arena-hub"))


def persisted_secret(path):
    # Create restrictive modes in the initial NFS CREATE, rather than relying
    # on a later chmod. The enclosing control directory must remain 0700.
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, "w") as output:
            output.write(secrets.token_hex(32))
            output.flush()
            os.fsync(output.fileno())
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "r") as incoming:
        info = os.fstat(incoming.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1:
            raise ValueError("Unsafe persisted Hub secret")
        value = incoming.read(256).strip()
    if not re.fullmatch(r"[a-fA-F0-9]{64}", value):
        raise ValueError("Invalid persisted Hub secret; refusing to rotate it")
    path.chmod(0o600)
    return value


def mirror_cookie_secret(path, value):
    # JupyterHub retains its strict file-mode check on a local POSIX file.
    # The NFS source remains persistent below root-only control, even when
    # that filesystem reports broader modes for individual files.
    private_directory(path.parent)
    fd, temp = tempfile.mkstemp(prefix="cookie-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            output.write(value)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    info = path.stat()
    if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise RuntimeError("Runtime cookie secret must be owned by root with mode 0600")


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

    def run(self, action, *, pass_fds=(), **values):
        # NFS sees the remapped user ID, not container-root's DAC/CHOWN caps.
        # Write as the final owner; never make a team home world-readable.
        request = {"action": action, "home": str(self.home), "uid": self.uid, "gid": self.gid, **values}
        result = subprocess.run(
            ["/opt/arena/hub-venv/bin/python", "/opt/arena/hub_runtime.py", "--team-files", json.dumps(request)],
            user=self.uid, group=self.gid, extra_groups=[], pass_fds=pass_fds,
            cwd="/tmp", env={"HOME": str(self.home), "PATH": "/usr/bin:/bin"},
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode:
            try:
                detail = json.loads(result.stdout)
            except (ValueError, TypeError):
                detail = {}
                kind = "bundle-path" if "can't open file" in result.stderr else "module-import" if "ModuleNotFoundError" in result.stderr else "worker-exit"
                logging.getLogger("arena.hub").warning("team file worker failed action=%s kind=%s exit=%s", action, kind, result.returncode)
            if detail.get("unsafe"):
                raise ValueError("Unsafe team filesystem path")
            raise OSError(detail.get("errno") or 5, "Team filesystem operation failed: " + action)

    def mkdir(self, parts):
        if os.geteuid() != self.uid:
            return self.run("mkdir", parts=list(parts))
        fd = self.parent(parts)
        os.close(fd)

    def parent(self, parts):
        if os.geteuid() != self.uid:
            raise RuntimeError("Team directory operations must use the team UID")
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
                os.close(fd)
                fd = child
            return fd
        except BaseException:
            os.close(fd)
            raise

    def install(self, relative, source, link=False):
        if os.geteuid() != self.uid:
            if link:
                return self.run("install", relative=str(relative), source=str(source), link=True)
            incoming = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                return self.run("install", relative=str(relative), source_fd=incoming, pass_fds=(incoming,))
            finally:
                os.close(incoming)
        parts = Path(relative).parts
        if not parts or Path(relative).is_absolute():
            raise ValueError("Unsafe destination")
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
                incoming = os.fdopen(os.dup(source), "rb") if isinstance(source, int) else Path(source).open("rb")
                with os.fdopen(target, "wb") as output, incoming:
                    shutil.copyfileobj(incoming, output)
        finally:
            os.close(fd)


class HubManager:
    def __init__(self, root):
        if not hasattr(os, "geteuid") or os.geteuid() != 0:
            raise RuntimeError("JupyterHub needs Linux root to switch to team UIDs")
        self.root = Path(root)
        if self.root.is_symlink():
            raise ValueError("Unsafe workspace root")
        os.chown(self.root, 0, 0)
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
            os.chown(path, 0, 0)
            path.chmod(0o755)
        self.guard = threading.RLock()
        self.users = self._read("users.json", {})
        self.published = self._read("assets.json", {})
        self.runtime = runtime_directory()
        for name in ("service-token", "cookie-secret", "proxy-token"):
            value = persisted_secret(self.control / name)
            if name == "cookie-secret":
                mirror_cookie_secret(self.runtime / name, value)

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
            files = TeamFiles(home, old["uid"], old["uid"])
            if home.exists() and home.stat().st_uid != old["uid"]:
                # The previous implementation can leave an empty root-owned
                # home after failed chown. Repair only that exact empty case.
                if home.stat().st_uid != 0 or any(home.iterdir()):
                    raise RuntimeError("Existing home ownership needs administrator review; files preserved")
                home.rmdir()
            if not home.exists():
                # A passed FD reaches a staging parent below root-only control.
                # Other teams cannot traverse .arena to reach this temporary
                # writable parent. The child creates its own 0700 home, then
                # root publishes it by rename without changing ownership.
                with tempfile.TemporaryDirectory(prefix="team-home-", dir=self.control) as staging:
                    Path(staging).chmod(0o777)
                    fd = os.open(staging, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                    try:
                        files.run("create-home", parent_fd=fd, pass_fds=(fd,))
                        os.rename(Path(staging) / "home", home)
                    finally:
                        os.close(fd)
            files.run("check-home")
            # Directory FDs reject contestant-controlled symlinks before use.
            files.mkdir((".venvs",))
            venv = home / ".venvs" / "pytorch"
            clean = {"HOME": str(home), "USER": name, "PATH": "/usr/bin:/bin"}
            script = "import venv,pathlib,sys; p=pathlib.Path(sys.argv[1]); exists=(p/'bin/python').exists(); venv.create(p,system_site_packages=True,with_pip=True) if not exists else None; site=next(p.glob('lib/python*/site-packages')); marker=site/'arena-base.pth'; marker.write_text('/opt/arena/venv/lib/python3.10/site-packages\\n') if not marker.exists() else None"
            # The existence check also runs as the team: NFS can deny root a
            # read of a valid existing 0700 home after container UID remapping.
            subprocess.run([os.getenv("ARENA_SYSTEM_PYTHON", "/usr/bin/python3"), "-c", script, str(venv)], env=clean, cwd="/tmp", user=old["uid"], group=old["uid"], extra_groups=[], check=True, timeout=90)
            kernel = self.control / (name + "-kernel.json")
            atomic_json(kernel, {"argv": [str(venv / "bin/python"), "-m", "ipykernel_launcher", "-f", "{connection_file}"], "display_name": "Python (PyTorch · riêng đội)", "language": "python"})
            files.install(".local/share/jupyter/kernels/pytorch/kernel.json", kernel)
            files.install(".local/share/jupyter/kernels/python3/kernel.json", kernel)
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
            step = "stop"
            try:
                if not team["enabled"] or team["desiredState"] == "stopped":
                    if server:
                        self.hub_request("DELETE", "/users/" + name + "/server")
                    reports.append(report)
                    continue
                if server.get("ready"):
                    step = "dataset"
                    report["publicReady"], report["privateReady"] = self.install_assets(team["teamId"], policy)
                    report["state"] = "ready"
                elif server or observed.get("pending"):
                    report["state"] = "starting"
                elif active >= policy["hub"].get("maxTeamServers", 7) or pending >= 2 or measured["availableRAMGiB"] is None or measured["availableRAMGiB"] < 4 or measured["freeDiskGiB"] < 2:
                    report["state"] = "waiting-resource"
                else:
                    step = "account"
                    self.ensure_user(team["teamId"])
                    step = "dataset"
                    report["publicReady"], report["privateReady"] = self.install_assets(team["teamId"], policy)
                    if not observed:
                        step = "hub-user"
                        self.hub_request("POST", "/users/" + name)
                    step = "hub-start"
                    self.hub_request("POST", "/users/" + name + "/server")
                    active += 1; pending += 1
                    report["state"] = "starting"
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, httpx.HTTPError) as error:
                # Fixed fields only; exception strings/HTTP bodies can contain
                # paths, signed URLs or credentials. Keep those out of logs.
                logging.getLogger("arena.hub").warning("team preparation failed step=%s type=%s errno=%s", step, type(error).__name__, getattr(error, "errno", None))
                report.update(state="error", error="Không chuẩn bị được workspace (" + step + "). Admin kiểm tra runtime.")
            reports.append(report)
        return {"runId": policy["runId"], "hubReady": True, "resources": measured, "notebooks": reports}


def team_files_worker(request):
    files = TeamFiles(request["home"], request["uid"], request["gid"])
    if os.geteuid() != files.uid or os.getegid() != files.gid or not 10000 <= files.uid < 60000:
        raise ValueError("Invalid team worker identity")
    action = request["action"]
    if action == "create-home":
        os.mkdir("home", 0o700, dir_fd=request["parent_fd"])
    elif action == "check-home":
        fd = os.open(files.home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if os.fstat(fd).st_uid != files.uid:
                raise ValueError("Unexpected home owner")
            os.fchmod(fd, 0o700)
        finally:
            os.close(fd)
    elif action == "mkdir":
        files.mkdir(request["parts"])
    elif action == "install":
        files.install(request["relative"], request.get("source_fd", request.get("source")), request.get("link", False))
    else:
        raise ValueError("Invalid team worker operation")


if __name__ == "__main__" and sys.argv[1:2] == ["--team-files"]:
    try:
        team_files_worker(json.loads(sys.argv[2]))
    except (OSError, ValueError) as error:
        print(json.dumps({"errno": getattr(error, "errno", None), "unsafe": isinstance(error, ValueError)}))
        sys.exit(1)
