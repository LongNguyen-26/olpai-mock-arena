"""Root-only Hub provisioning. Notebook code is never executed by this module."""
import json
import array
import base64
import hashlib
import logging
import os
import re
import secrets
import shutil
import stat
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import httpx

PROTOCOL = 1
DATA_UID = 62000  # Outside the team UID range; never assigned to a notebook.
TEAM_ID = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")


def username(team_id):
    if not TEAM_ID.fullmatch(team_id):
        raise ValueError("Invalid team ID")
    return "t" + team_id.replace("-", "")[:24]


def atomic_json(path, value):
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w", encoding="utf-8") as output:
        json.dump(value, output)
        output.flush(); os.fsync(output.fileno())
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
    # NFS can retain the CREATE mode even when a later chmod succeeds.
    # Set confidentiality in the initial mkdir instead of creating 0755 first.
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("Unsafe control directory")
    # Do not issue needless SETATTR calls for already-correct NFS metadata.
    # Preserve benign setgid/sticky bits while enforcing all access bits.
    before = path.stat()
    try:
        if before.st_uid != 0:
            os.chown(path, 0, 0)
        if stat.S_IMODE(before.st_mode) & 0o777 != 0o700:
            path.chmod(0o700)
    except OSError as error:
        raise RuntimeError(
            "Cannot secure control directory: "
            f"name={path.name} uid={before.st_uid} gid={before.st_gid} "
            f"mode={oct(stat.S_IMODE(before.st_mode))} errno={error.errno}"
        ) from None
    info = path.stat()
    if info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o777 != 0o700:
        raise RuntimeError(
            "Control directory must be owned by root with mode 0700: "
            f"name={path.name} uid={info.st_uid} gid={info.st_gid} mode={oct(stat.S_IMODE(info.st_mode))}"
        )


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
    if stat.S_IMODE(info.st_mode) & 0o777 != 0o600:
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


class HubState:
    """Local private control, authenticated encrypted checkpoints on the volume."""
    names = ("users.json", "assets.json", "service-token", "cookie-secret", "proxy-token", "hub.sqlite")
    limit = 32 * 1024**2
    magic = b"ARENA-HUB-STATE-1\0"

    def __init__(self, root, control):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        identity = os.getenv("ARENA_WORKSPACE_ID", "")
        token = os.getenv("ARENA_AGENT_TOKEN", "")
        if not TEAM_ID.fullmatch(identity) or len(token) < 32:
            raise RuntimeError("Encrypted Hub state requires workspace identity and server credential")
        self.root, self.control = Path(root), Path(control)
        self.path = self.root / ".arena-hub-state-v1.enc"
        self.aad = ("arena-hub-state-v1:" + identity).encode()
        secret = hashlib.sha256(b"arena-hub-state-key-v1\0" + token.encode()).digest()
        self.cipher = AESGCM(secret)
        self.binding = hashlib.sha256(self.aad + secret).hexdigest()

    @contextmanager
    def locked(self):
        import fcntl
        fd = os.open(self.control / ".snapshot.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    def restore(self):
        with self.locked():
            marker = self.control / ".binding.json"
            if marker.exists():
                if json.loads(marker.read_text()) != {"binding": self.binding}:
                    raise RuntimeError("Local Hub state belongs to another workspace or credential")
                if self.path.exists() and any(not (self.control / name).exists() for name in ("service-token", "cookie-secret", "proxy-token")):
                    raise RuntimeError("Local Hub control is incomplete; refusing to rotate persisted keys")
                return False
            if self.path.is_symlink():
                raise ValueError("Unsafe encrypted Hub state path")
            if self.path.exists():
                fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd, "rb") as incoming:
                    blob = incoming.read(self.limit + 1)
                try:
                    if len(blob) > self.limit or not blob.startswith(self.magic):
                        raise ValueError()
                    raw = self.cipher.decrypt(blob[len(self.magic):len(self.magic)+12], blob[len(self.magic)+12:], self.aad)
                    payload = json.loads(raw)
                    if payload.get("version") != 1 or not isinstance(payload.get("files"), dict) or set(payload["files"]) - set(self.names):
                        raise ValueError()
                    decoded = {name: base64.b64decode(value, validate=True) for name, value in payload["files"].items()}
                    if any(len(value) > self.limit for value in decoded.values()):
                        raise ValueError()
                    if any(not re.fullmatch(rb"[a-fA-F0-9]{64}", decoded.get(name, b"")) for name in ("service-token", "cookie-secret", "proxy-token")):
                        raise ValueError()
                except Exception:
                    raise ValueError("Encrypted Hub state is invalid; refusing to replace or rotate it") from None
                for name, value in decoded.items():
                    fd, temp = tempfile.mkstemp(dir=self.control, prefix="restore-")
                    with os.fdopen(fd, "wb") as output:
                        output.write(value)
                    os.replace(temp, self.control / name)
            elif (self.root / "teams").exists() and any((self.root / "teams").iterdir()):
                raise RuntimeError("Hub state checkpoint is missing; existing team files preserved")
            elif (self.root / ".arena/hub").exists():
                raise RuntimeError("Legacy Hub volume requires explicit migration; use a new Pod for this image")
            atomic_json(marker, {"binding": self.binding})
            return True

    def flush(self):
        with self.locked():
            files = {}
            for name in self.names:
                path = self.control / name
                if not path.exists():
                    continue
                if path.is_symlink() or path.stat().st_size > self.limit:
                    raise ValueError("Invalid local Hub state file")
                if name == "hub.sqlite":
                    fd, backup = tempfile.mkstemp(dir=self.control, prefix="sqlite-")
                    os.close(fd)
                    deadline = time.monotonic() + 5
                    def progress(*_):
                        if time.monotonic() > deadline:
                            raise TimeoutError("Hub database checkpoint is busy")
                    try:
                        with sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True, timeout=2) as source, sqlite3.connect(backup) as target:
                            source.backup(target, pages=128, progress=progress, sleep=0.02)
                        value = Path(backup).read_bytes()
                    finally:
                        Path(backup).unlink(missing_ok=True)
                else:
                    value = path.read_bytes()
                files[name] = base64.b64encode(value).decode()
            raw = json.dumps({"version": 1, "files": files}, separators=(",", ":")).encode()
            if len(raw) > self.limit - 1024:
                raise ValueError("Hub checkpoint exceeds its size limit")
            nonce = secrets.token_bytes(12)
            blob = self.magic + nonce + self.cipher.encrypt(nonce, raw, self.aad)
            fd, temp = tempfile.mkstemp(dir=self.root, prefix=".arena-encrypted-")
            try:
                with os.fdopen(fd, "wb") as output:
                    output.write(blob); output.flush(); os.fsync(output.fileno())
                os.replace(temp, self.path)
            finally:
                Path(temp).unlink(missing_ok=True)


def data_request(root, action, want_fd=False, **values):
    """Run volume operations as a separate UID, without control credentials."""
    parent, child = socket.socketpair()
    try:
        result = subprocess.run(
            ["/opt/arena/hub-venv/bin/python", "/opt/arena/hub_runtime.py", "--data-worker"],
            input=json.dumps({"root": str(root), "action": action, "socket": child.fileno(), **values}),
            user=DATA_UID, group=DATA_UID, extra_groups=[], pass_fds=(child.fileno(),),
            cwd="/tmp", env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "PYTHONNOUSERSITE": "1"}, capture_output=True, text=True,
            timeout=600 if action == "publish" else 30,
        )
        if result.returncode:
            try: metadata = json.loads(result.stdout).get("metadata", [])
            except ValueError: metadata = []
            raise RuntimeError("Volume operation failed: " + action + "; non-root storage metadata=" + json.dumps(metadata))
        value = json.loads(result.stdout)
        if want_fd:
            parent.settimeout(2)
            _, messages, _, _ = parent.recvmsg(1, socket.CMSG_SPACE(array.array("i").itemsize))
            fds = array.array("i")
            for level, kind, raw in messages:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    fds.frombytes(raw[:len(raw) - len(raw) % fds.itemsize])
            if len(fds) != 1:
                for fd in fds: os.close(fd)
                raise RuntimeError("Missing volume descriptor")
            return value, fds[0]
        return value
    finally:
        parent.close(); child.close()


def volume_directory(root, path, mode):
    """POSIX volumes allow chown; root-squashed volumes create under DATA_UID."""
    if path.is_symlink():
        raise ValueError("Unsafe volume directory")
    if not path.exists():
        path.mkdir(mode=mode)
        try:
            os.chown(path, DATA_UID, DATA_UID)
        except OSError as error:
            if error.errno not in (1, 13, 95): raise
        if path.stat().st_uid != DATA_UID:
            path.rmdir()  # Only this just-created empty directory.
    elif path.stat().st_uid != DATA_UID:
        raise RuntimeError("Existing volume directory needs migration; files preserved")


def open_published(root_fd, relative):
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(p in ("", ".", "..") for p in parts):
        raise ValueError("Unsafe published asset path")
    fd = os.dup(root_fd)
    try:
        for i, part in enumerate(parts):
            child = os.open(part, os.O_RDONLY | os.O_NOFOLLOW | (os.O_DIRECTORY if i < len(parts)-1 else 0), dir_fd=fd)
            os.close(fd); fd = child
            info = os.fstat(fd)
            if info.st_uid != DATA_UID or info.st_mode & 0o022:
                raise ValueError("Published asset ownership or permissions changed")
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("Invalid published asset")
        return fd
    except BaseException:
        os.close(fd)
        raise


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
            cwd="/tmp", env={"HOME": str(self.home), "PATH": "/usr/bin:/bin", "PYTHONNOUSERSITE": "1"},
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
            logging.getLogger("arena.hub").warning("team filesystem failed action=%s uid=%s mode=%s errno=%s", action, detail.get("uid"), detail.get("mode"), detail.get("errno"))
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
            incoming = os.dup(source) if isinstance(source, int) else os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
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
        self.runtime = runtime_directory()
        private_directory(self.runtime)
        self.control = self.runtime / "control"
        private_directory(self.control)
        self.state = HubState(self.root, self.control)
        restored = self.state.restore()
        self.teams_root = self.root / "teams"
        self.shared = self.root / "datasets"
        self.volume_cache = self.root / ".arena-assets-v2"
        for path, mode in ((self.teams_root, 0o755), (self.shared, 0o755), (self.volume_cache, 0o700)):
            volume_directory(self.root, path, mode)
        data_request(self.root, "init")
        self.shared_fd = os.open(self.shared, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.guard = threading.RLock()
        self.users = self._read("users.json", {})
        self.published = self._read("assets.json", {})
        for name in ("service-token", "cookie-secret", "proxy-token"):
            value = persisted_secret(self.control / name)
            if name == "cookie-secret":
                mirror_cookie_secret(self.runtime / name, value)
        if restored or not self.state.path.exists():
            self.state.flush()

    def __del__(self):
        fd = getattr(self, "shared_fd", None)
        if fd is not None:
            try: os.close(fd)
            except OSError: pass

    def _read(self, name, default):
        path = self.control / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default

    def check_privileges(self):
        if os.geteuid() != 0:
            raise RuntimeError("JupyterHub needs root to switch to team UIDs")
        # A child proves setgroups/setgid/setuid work, without altering the agent.
        subprocess.run([os.getenv("ARENA_SYSTEM_PYTHON", "/usr/bin/python3"), "-c", "import os; os.setgroups([]); os.setgid(65534); os.setuid(65534); assert os.geteuid()==65534"], check=True, timeout=10)

    def ensure_user(self, team_id, prepare=True):
        import pwd
        import grp
        name = username(team_id)
        with self.guard:
            old = self.users.get(team_id)
            if old is None:
                homes = data_request(self.root, "homes")
                used = {v["uid"] for v in self.users.values()} | {v.pw_uid for v in pwd.getpwall()} | {v.gr_gid for v in grp.getgrall()} | set(homes.values())
                uid = homes.get(team_id) or next(i for i in range(10000, 60000) if i not in used)
                if not 10000 <= uid < 60000 or any(v["uid"] == uid for v in self.users.values()) or any(k != team_id and v == uid for k, v in homes.items()):
                    raise RuntimeError("Persisted team UID collision")
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
            if not prepare:
                return {**old, "home": str(home)}
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
                stage, fd = data_request(self.root, "home-stage", want_fd=True)
                try:
                    files.run("create-home", parent_fd=fd, pass_fds=(fd,))
                    data_request(self.root, "home-publish", team_id=team_id, stage=stage["stage"])
                finally:
                    os.close(fd)
                    data_request(self.root, "stage-clean", stage=stage["stage"])
            if not data_request(self.root, "home-status", team_id=team_id, uid=old["uid"])["activated"]:
                # The directory is still empty at publication. Lock it before
                # writing any data, reject any injected entry, then durably
                # mark activation outside the team's writable home.
                files.run("activate-home")
                data_request(self.root, "home-activated", team_id=team_id, uid=old["uid"])
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
        if not data_request(self.root, "exists", digest=digest)["exists"]:
            _, fd = data_request(self.root, "cache", want_fd=True, digest=digest)
            try:
                # Descriptor access bypasses only the private cache's ancestors.
                # Keep the existing checksum/ZIP checks; no control paths here.
                source = Path("/proc/self/fd") / str(fd)
                load(asset, source)
                for item in source.rglob("*"):
                    if item.is_symlink():
                        raise ValueError("Unsafe cached asset")
                    if item.stat().st_uid == 0:
                        item.chmod(0o755 if item.is_dir() else 0o444)
            finally:
                os.close(fd)
        # Recheck the live gate after potentially long downloads.
        latest = current_policy()
        if not latest.get("active") or not any(a.get("sha256") == digest for a in latest.get("assets", [])):
            return
        data_request(self.root, "publish", digest=digest, task_root=asset.get("workspaceLayout") == "task-root", phase=asset["phase"])
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
            catalog = data_request(self.root, "catalog", digest=digest, task_root=self.published[digest]["taskRoot"], phase=asset["phase"])
            if self.published[digest]["taskRoot"]:
                for rel in catalog["starters"]:
                    fd = open_published(self.shared_fd, Path(digest) / rel)
                    try: files.install(rel, fd)
                    finally: os.close(fd)
            for rel in catalog["datasets"]:
                files.install(rel, self.shared / digest / rel, link=True)
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
        os.umask(0)
        # A non-root publisher must update '..' during rename. This empty
        # directory stays below private staging, and is locked immediately
        # after publication, before venvs, config or notebooks are written.
        os.mkdir("home", 0o777, dir_fd=request["parent_fd"])
    elif action in ("check-home", "activate-home"):
        fd = os.open(files.home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if os.fstat(fd).st_uid != files.uid:
                raise ValueError("Unexpected home owner")
            os.fchmod(fd, 0o700)
            if os.fstat(fd).st_mode & 0o777 != 0o700:
                raise RuntimeError("Volume cannot enforce team home mode 0700")
            if action == "activate-home" and os.listdir(fd):
                raise ValueError("New home was modified before activation; files preserved")
        finally:
            os.close(fd)
    elif action == "mkdir":
        files.mkdir(request["parts"])
    elif action == "install":
        files.install(request["relative"], request.get("source_fd", request.get("source")), request.get("link", False))
    else:
        raise ValueError("Invalid team worker operation")


def data_worker(request):
    if os.geteuid() != DATA_UID or os.getegid() != DATA_UID:
        raise ValueError("Invalid volume worker identity")
    os.umask(0)  # Isolated single-purpose process; modes apply at CREATE.
    root = Path(request["root"])
    cache, teams, shared = root / ".arena-assets-v2", root / "teams", root / "datasets"
    for path, mode in ((cache, 0o700), (teams, 0o755), (shared, 0o755)):
        if path.is_symlink():
            raise ValueError("Unsafe volume root")
        path.mkdir(mode=mode, exist_ok=True)
        if path.stat().st_uid != DATA_UID or path.stat().st_mode & 0o777 != mode:
            if path.stat().st_uid == DATA_UID: path.chmod(mode)
            if path.stat().st_uid != DATA_UID or path.stat().st_mode & 0o777 != mode:
                raise RuntimeError("Volume does not enforce non-root UID permissions")
    action = request["action"]
    result, descriptor = {}, None
    if action == "init":
        pass
    elif action == "homes":
        result = {p.name: p.stat().st_uid for p in teams.iterdir() if TEAM_ID.fullmatch(p.name) and not p.is_symlink() and p.is_dir()}
    elif action in ("home-status", "home-activated"):
        team_id, uid = request["team_id"], request["uid"]
        if not TEAM_ID.fullmatch(team_id) or not 10000 <= uid < 60000:
            raise ValueError("Invalid activation identity")
        marker = cache / ("activated-" + team_id + ".json")
        if marker.is_symlink(): raise ValueError("Unsafe activation marker")
        if action == "home-activated":
            info = (teams / team_id).stat()
            if info.st_uid != uid or info.st_mode & 0o777 != 0o700:
                raise ValueError("Unverified home activation")
            atomic_json(marker, {"uid": uid})
        result = {"activated": marker.exists() and json.loads(marker.read_text()) == {"uid": uid}}
    elif action in ("home-stage", "cache"):
        if action == "home-stage":
            path = cache / ("home-" + secrets.token_hex(16))
            path.mkdir(mode=0o777)
            result = {"stage": path.name}
        else:
            digest = request["digest"]
            if not re.fullmatch(r"[a-f0-9]{64}", digest): raise ValueError("Invalid checksum")
            path = cache / digest
            path.mkdir(mode=0o777, exist_ok=True)
            path.chmod(0o777)
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    elif action in ("home-publish", "stage-clean"):
        stage = request["stage"]
        if not re.fullmatch(r"home-[a-zA-Z0-9_-]+", stage): raise ValueError("Invalid home stage")
        parent = cache / stage
        fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if action == "home-publish":
                team_id = request["team_id"]
                if not TEAM_ID.fullmatch(team_id): raise ValueError("Invalid team")
                if (teams / team_id).exists(): raise FileExistsError("Home already exists")
                os.rename("home", teams / team_id, src_dir_fd=fd)
            else:
                # A failed stage can contain only an empty team-owned home.
                try: os.rmdir("home", dir_fd=fd)
                except FileNotFoundError: pass
        finally:
            os.close(fd)
        if action == "stage-clean": parent.rmdir()
    elif action in ("publish", "catalog", "exists"):
        digest = request["digest"]
        if not re.fullmatch(r"[a-f0-9]{64}", digest): raise ValueError("Invalid checksum")
        target = shared / digest
        if target.is_symlink() or (target.exists() and target.stat().st_uid != DATA_UID):
            raise ValueError("Unsafe published data")
        if action == "exists":
            result = {"exists": target.is_dir()}
        elif action == "publish":
            if not target.exists():
                source = cache / digest
                stage = Path(tempfile.mkdtemp(prefix="publish-", dir=cache))
                try:
                    if request["task_root"]:
                        for task in source.glob("Tac_vu_*"):
                            if task.is_symlink(): raise ValueError("Unsafe cached task")
                            shutil.copytree(task, stage / task.name, copy_function=shutil.copyfile)
                    else:
                        phase = request["phase"]
                        if phase not in ("public", "private"): raise ValueError("Invalid phase")
                        shutil.copytree(source / "data" / phase, stage / "data" / phase, copy_function=shutil.copyfile)
                    for item in stage.rglob("*"):
                        if item.is_symlink(): raise ValueError("Unsafe published dataset")
                        mode = 0o755 if item.is_dir() else 0o444
                        item.chmod(mode)
                        if item.stat().st_mode & 0o777 != mode:
                            raise RuntimeError("Volume cannot enforce readonly dataset permissions")
                    stage.chmod(0o755)
                    stage.replace(target)
                finally:
                    if stage.exists(): shutil.rmtree(stage)
        else:
            starters, datasets = [], []
            if request["task_root"]:
                for task in target.glob("Tac_vu_*"):
                    for folder, directories, names in os.walk(task, followlinks=False):
                        directories[:] = [d for d in directories if d != "dataset"]
                        for name in names:
                            item = Path(folder) / name
                            if item.is_symlink(): raise ValueError("Unsafe starter")
                            starters.append(str(item.relative_to(target)))
                    data = task / "dataset"
                    if data.exists(): datasets += [str(p.relative_to(target)) for p in data.iterdir()]
            else:
                phase = request["phase"]
                if phase not in ("public", "private"): raise ValueError("Invalid phase")
                datasets = [str(p.relative_to(target)) for p in (target / "data" / phase).iterdir()]
            if len(starters) + len(datasets) > 10000: raise ValueError("Asset catalogue too large")
            result = {"starters": starters, "datasets": datasets}
    else:
        raise ValueError("Invalid volume operation")
    if descriptor is not None:
        with socket.socket(fileno=request["socket"]) as channel:
            channel.sendmsg([b"F"], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [descriptor]))])
        os.close(descriptor)
    return result


if __name__ == "__main__" and sys.argv[1:2] == ["--team-files"]:
    request = {}
    try:
        request = json.loads(sys.argv[2])
        team_files_worker(request)
    except (OSError, ValueError, RuntimeError) as error:
        detail = {"errno": getattr(error, "errno", None), "unsafe": isinstance(error, ValueError)}
        try:
            info = Path(request["home"]).lstat()
            detail.update(uid=info.st_uid, mode=oct(info.st_mode & 0o7777))
        except (KeyError, OSError): pass
        print(json.dumps(detail))
        sys.exit(1)

if __name__ == "__main__" and sys.argv[1:2] == ["--data-worker"]:
    request = {}
    try:
        request = json.loads(sys.stdin.read(1024 * 1024))
        print(json.dumps(data_worker(request)))
    except (OSError, ValueError, RuntimeError) as error:
        metadata = []
        for name in ("teams", "datasets", ".arena-assets-v2"):
            try:
                info = (Path(request["root"]) / name).lstat()
                metadata.append({"name": name, "uid": info.st_uid, "gid": info.st_gid, "mode": oct(info.st_mode & 0o7777)})
            except (OSError, KeyError): pass
        print(json.dumps({"error": type(error).__name__, "errno": getattr(error, "errno", None), "metadata": metadata}))
        sys.exit(1)
