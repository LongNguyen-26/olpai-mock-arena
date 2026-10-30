"""Real Linux UID/Hub/kernel/RTC tests. CPU only; all Arena traffic is local."""
import json
import os
import secrets
import signal
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import uuid
import zipfile
import datetime
import hashlib
import io
import ipaddress
import ssl
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
from hub_runtime import HubManager, TeamFiles, username, DATA_UID, data_request
import start as startup


@unittest.skipUnless(os.name == "posix" and hasattr(os, "geteuid") and os.geteuid() == 0,
                     "requires disposable Linux runner with root")
class LinuxHubTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="arena-hub-")
        Path(cls.temp.name).chmod(0o755)
        cls.root = Path(cls.temp.name) / "workspace"
        cls.root.mkdir()
        cls.token = "qa-" + secrets.token_hex(32)
        cls.identity = str(uuid.uuid4())
        cls.env_patch = patch.dict(os.environ, {"ARENA_AGENT_TOKEN": cls.token, "ARENA_WORKSPACE_ID": cls.identity,
                                              "ARENA_HUB_RUNTIME_ROOT": str(Path(cls.temp.name) / "runtime")})
        cls.env_patch.start()
        cls.manager = HubManager(cls.root)
        # Reproduce the provider failure at initial Hub startup: the NFS
        # source may report broad file modes inside a private control folder.
        (cls.manager.control / "cookie-secret").chmod(0o666)
        cls.manager.check_privileges()
        cls.team_ids = [str(uuid.uuid4()) for _ in range(4)]
        cls.teams = [{"teamId": i, "teamName": "QA " + str(n), "enabled": True, "desiredState": "running", "revision": str(uuid.uuid4())} for n, i in enumerate(cls.team_ids)]
        cls.policy = {"active": True, "runId": str(uuid.uuid4()), "privateLocked": True, "assets": [], "hub": {"teams": cls.teams[:3], "maxTeamServers": 7}}
        cls.tickets = {}

        class Arena(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                query = parse_qs(urlparse(self.path).query)
                if urlparse(self.path).path == "/api/status":
                    self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
                    self.wfile.write(b'{"status":"ok"}')
                elif urlparse(self.path).path.endswith("/hub/authorize"):
                    ticket = secrets.token_urlsafe(32)
                    cls.tickets[ticket] = {"state": query["state"][0], "teamId": query["teamId"][0]}
                    self.send_response(302)
                    self.send_header("Location", "http://127.0.0.1:8888/hub/arena-login?" + urlencode({"ticket": ticket, "state": query["state"][0]}))
                    self.end_headers()
                else:
                    self.send_response(404); self.end_headers()

            def do_POST(self):
                value = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                ticket = cls.tickets.pop(value.get("ticket"), None)
                if self.headers.get("Authorization") != "Bearer " + cls.token or not ticket or ticket["state"] != value.get("state"):
                    self.send_response(403); self.end_headers(); return
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(json.dumps({"username": username(ticket["teamId"]), "teamId": ticket["teamId"]}).encode())

        cls.arena = ThreadingHTTPServer(("127.0.0.1", 19090), Arena)
        threading.Thread(target=cls.arena.serve_forever, daemon=True).start()
        cls.probe = ThreadingHTTPServer(("127.0.0.1", 8000), Arena)
        threading.Thread(target=cls.probe.serve_forever, daemon=True).start()
        env = {**os.environ, "ARENA_WORKSPACE_ROOT": str(cls.root), "ARENA_WORKSPACE_ID": cls.identity,
               "ARENA_CONTROL_URL": "http://127.0.0.1:19090/api/workspace/manifest", "ARENA_AGENT_TOKEN": cls.token,
               "ARENA_TEST_HTTP": "1", "ARENA_MAX_TEAM_SERVERS": "7"}
        env.pop("RUNPOD_POD_ID", None)
        # Match the deployed CLI environment. An injected PYTHONPATH previously
        # hid a config import failure that caused the real Pod to restart-loop.
        env.pop("PYTHONPATH", None)
        cls.hub_env = env
        cls.log = open(Path(cls.temp.name) / "hub.log", "wb")
        cls.process = subprocess.Popen(["/opt/arena/hub-venv/bin/jupyterhub", "--config=/opt/arena/hub_config.py"], env=env, cwd=cls.root, stdout=cls.log, stderr=cls.log, start_new_session=True)
        try:
            cls.wait(lambda: cls.manager.hub_request("GET", "/info"), 60)
            # Fail immediately on a helper launch problem, instead of hiding
            # it behind repeated reconciliation and a long spawn timeout.
            for team in cls.policy["hub"]["teams"]:
                cls.manager.ensure_user(team["teamId"])
            cls.wait(lambda: cls.all_ready(cls.manager.reconcile(cls.policy), 3), 150)
        except BaseException:
            cls.process.terminate(); cls.process.wait(timeout=20)
            # Runtime logs are not uploaded; print only a bounded diagnostic.
            cls.log.flush()
            print((Path(cls.temp.name) / "hub.log").read_text(errors="replace")[-5000:])
            raise

    @classmethod
    def all_ready(cls, report, count):
        return sum(n["state"] == "ready" for n in report["notebooks"]) == count

    @classmethod
    def wait(cls, callback, timeout=40):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                value = callback()
                if value:
                    return value
            except (httpx.HTTPError, OSError):
                pass
            time.sleep(1)
        raise AssertionError("Timed out waiting for Hub/server readiness")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(cls.process.pid, signal.SIGKILL); cls.process.wait()
        cls.arena.shutdown(); cls.arena.server_close(); cls.probe.shutdown(); cls.probe.server_close(); cls.log.close()
        for item in cls.manager.users.values():
            subprocess.run(["pkill", "-KILL", "-u", str(item["uid"])], check=False)
            subprocess.run(["userdel", item["name"]], check=False)
            subprocess.run(["groupdel", item["name"]], check=False, capture_output=True)
        cls.temp.cleanup()
        cls.env_patch.stop()

    def run_team(self, team_id, script):
        user = self.manager.ensure_user(team_id)
        return subprocess.run([str(Path(user["home"]) / ".venvs/pytorch/bin/python"), "-c", script],
                              env={"HOME": user["home"], "PATH": "/usr/bin:/bin"}, cwd=user["home"],
                              user=user["uid"], group=user["uid"], extra_groups=[], capture_output=True, text=True, timeout=20)

    def test_01_files_uid_and_secret_isolation(self):
        probe = httpx.get("http://127.0.0.1:8888/api/status", timeout=5)
        self.assertEqual(probe.status_code, 200)
        self.assertEqual(probe.json(), {"status": "ok"})
        a, b = self.team_ids[:2]
        self.assertNotEqual(httpx.get("http://127.0.0.1:8888/user/" + username(a) + "/api/contents", timeout=5).status_code, 200)
        a_user = self.manager.ensure_user(a)
        self.assertEqual(self.run_team(a, "import os; assert os.geteuid()!=0").returncode, 0)
        secret = self.manager.control / "service-token"
        self.assertNotEqual(self.run_team(a, f"open({str(secret)!r}).read()").returncode, 0)
        Path(a_user["home"], "private.txt").write_text("team A")
        self.assertNotEqual(self.run_team(b, f"open({str(Path(a_user['home']) / 'private.txt')!r}).read()").returncode, 0)
        again = HubManager(self.root).ensure_user(a)
        self.assertEqual(again["uid"], a_user["uid"])
        # Existing volumes must restore root ownership, not just directory mode.
        os.chown(self.manager.control, a_user["uid"], a_user["uid"])
        HubManager(self.root)
        self.assertEqual(self.manager.control.stat().st_uid, 0)
        self.assertNotEqual(self.run_team(a, f"open({str(secret)!r}).read()").returncode, 0)

    def test_02_readonly_dataset_private_gate_and_symlink(self):
        digest = "a" * 64
        asset = {"sha256": digest, "phase": "public", "workspaceLayout": "task-root"}
        policy = {**self.policy, "assets": [asset]}
        calls = []
        def loader(_asset, source):
            calls.append(source)
            folder = source / "Tac_vu_1/dataset/train"; folder.mkdir(parents=True)
            (folder / "x.csv").write_text("id\n1\n")
            (source / "Tac_vu_1/baseline.ipynb").write_text("{}")
        self.manager.cache_asset(asset, loader, lambda: policy)
        self.manager.cache_asset(asset, loader, lambda: policy)
        self.assertEqual(len(calls), 1)
        for team in self.team_ids[:2]:
            self.manager.install_assets(team, policy)
            self.assertEqual(self.run_team(team, "from pathlib import Path; assert Path('Tac_vu_1/dataset/train/x.csv').read_text().startswith('id')").returncode, 0)
            self.assertNotEqual(self.run_team(team, "open('Tac_vu_1/dataset/train/x.csv','w').write('overwrite')").returncode, 0)
            self.assertEqual(self.run_team(team, "open('checkpoint.txt','w').write('saved')").returncode, 0)
            self.assertFalse((self.root / "teams" / team / "Tac_vu_1/dataset/private_test").exists())
        private = {**asset, "sha256": "b" * 64, "phase": "private"}
        self.manager.cache_asset(private, lambda _a, source: None, lambda: policy)
        self.assertNotIn(private["sha256"], self.manager.published)
        user = self.manager.ensure_user(self.team_ids[0])
        (Path(user["home"]) / "escape").symlink_to(self.manager.control, target_is_directory=True)
        with self.assertRaises(OSError):
            TeamFiles(user["home"], user["uid"], user["uid"]).install("escape/new-secret", self.manager.control / "service-token")

    def test_03_add_fourth_team_keeps_existing_servers(self):
        old = {name: user["servers"][""]["started"] for name, user in ((u["name"], u) for u in self.manager.hub_request("GET", "/users")) if user.get("servers")}
        self.policy["hub"]["teams"] = self.teams
        self.wait(lambda: self.all_ready(self.manager.reconcile(self.policy), 4), 90)
        after = {u["name"]: u for u in self.manager.hub_request("GET", "/users")}
        for name, started in old.items():
            self.assertEqual(after[name]["servers"][""]["started"], started)

    def test_04_browser_rtc_kernel_and_cross_team_access(self):
        from playwright.sync_api import sync_playwright
        a = username(self.team_ids[0]); b = username(self.team_ids[1])
        base = "http://127.0.0.1:8888"
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            one, two, other = [browser.new_context() for _ in range(3)]
            page1, page2, page3 = one.new_page(), two.new_page(), other.new_page()
            for client in (page1, page2, page3):
                client.on("pageerror", lambda error: print("Browser error:", str(error)))
                client.on("console", lambda message: print("Browser console:", message.text[-500:]) if message.type == "error" else None)
                client.on("response", lambda response: print("HTTP error:", response.status, urlparse(response.url).path) if response.status >= 400 else None)
                client.on("websocket", lambda socket: print("WebSocket:", urlparse(socket.url).path))
            for page, team in ((page1, self.team_ids[0]), (page2, self.team_ids[0]), (page3, self.team_ids[1])):
                page.goto(base + "/hub/arena-login?teamId=" + team)
                page.locator(".jp-DirListing").wait_for(timeout=60000)
            response = page1.evaluate("""async (base) => {
                const token = document.cookie.split('; ').find(x => x.startsWith('_xsrf='))?.split('=').slice(1).join('=');
                const r = await fetch(base+'/api/contents/shared.ipynb', {method:'PUT', headers:{'Content-Type':'application/json','X-XSRFToken':decodeURIComponent(token||'')}, body:JSON.stringify({type:'notebook',content:{nbformat:4,nbformat_minor:5,metadata:{kernelspec:{name:'pytorch',display_name:'Python (PyTorch · riêng đội)',language:'python'},language_info:{name:'python'}},cells:[{cell_type:'code',execution_count:null,metadata:{},outputs:[],source:''}]}})});
                return r.status;
            }""", "/user/" + a)
            self.assertIn(response, (200, 201))
            for page in (page1, page2):
                # Collaboration 3.x supplies an RTC drive. A hand-built /tree/
                # URL selects the non-collaborative default drive instead.
                page.goto(base + "/user/" + a + "/lab")
                with page.expect_websocket(lambda socket: "/api/collaboration/room/" in socket.url and "globalAwareness" not in socket.url, timeout=30000):
                    page.locator(".jp-DirListing-item").filter(has_text="shared.ipynb").dblclick()
                page.locator(".jp-Notebook .jp-CodeCell .cm-content").first.wait_for(timeout=60000)
                dialog = page.locator(".jp-Dialog")
                if dialog.is_visible():
                    print("Notebook dialog:", dialog.inner_text())
                    selector = dialog.locator("select")
                    if selector.count():
                        selector.select_option("pytorch")
                        dialog.locator(".jp-mod-accept").click()
                    elif "trust" in dialog.inner_text().lower():
                        dialog.get_by_role("button", name="Trust", exact=True).click()
                    else:
                        raise AssertionError("Unexpected notebook dialog")
            editor = page1.locator(".jp-Notebook .jp-CodeCell .cm-content").first
            editor.click()
            editor.press_sequentially("print('rtc-shared')", delay=15)
            try:
                page2.wait_for_function("document.querySelector('.jp-Notebook .cm-content')?.textContent.includes('rtc-shared')")
            except Exception:
                for client in (page1, page2):
                    print("RTC diagnostics", client.evaluate("""() => { const c=JSON.parse(document.getElementById('jupyter-config-data').textContent); return {disableRTC:c.disableRTC,serverSideExecution:c.serverSideExecution,disabled:c.disabledExtensions,extensions:c.federated_extensions?.map(x=>x.name),text:document.querySelector('.jp-Notebook .cm-content')?.textContent} }"""))
                self.log.flush()
                logs = (Path(self.temp.name) / "hub.log").read_text(errors="replace").splitlines()
                print("\n".join(line for line in logs if any(term in line for term in ("ydoc", "collabor", "403", "404", "500", "Error", "Exception", "Traceback")))[-9000:])
                raise
            second = page2.locator(".jp-Notebook .jp-CodeCell .cm-content").first
            second.click(); second.press("ControlOrMeta+End"); second.press("Enter"); second.press_sequentially("print('second-client')", delay=15)
            page1.wait_for_function("document.querySelector('.jp-Notebook .cm-content')?.textContent.includes('second-client')")
            editor.press("Shift+Enter")
            page1.get_by_text("rtc-shared\nsecond-client", exact=False).first.wait_for(timeout=60000)
            page2.get_by_text("rtc-shared\nsecond-client", exact=False).first.wait_for(timeout=30000)
            self.assertIn(page3.request.get(base + "/user/" + a + "/api/contents").status, (401, 403, 404))
            # Execute through the actual browser kernel; root credentials must be absent.
            editor = page1.locator(".jp-Notebook .jp-CodeCell .cm-content").first
            editor.click(); editor.press("ControlOrMeta+A")
            editor.press_sequentially("import os, sys\nprint('uid-check', os.geteuid() != 0, 'ARENA_AGENT_TOKEN' not in os.environ, 'CONFIGPROXY_AUTH_TOKEN' not in os.environ)\nprint('venv-check', '.venvs/pytorch' in sys.prefix)")
            editor.press("Shift+Enter")
            page1.get_by_text("uid-check True True True", exact=False).first.wait_for(timeout=30000)
            print("Kernel specs:", {k: v["spec"]["argv"] for k, v in page1.request.get(base + "/user/" + a + "/api/kernelspecs").json()["kernelspecs"].items()})
            print("Kernel output:", page1.locator(".jp-Notebook .jp-OutputArea").first.inner_text())
            page1.get_by_text("venv-check True", exact=False).first.wait_for(timeout=30000)
            page1.keyboard.press("ControlOrMeta+s")
            self.wait(lambda: "uid-check" in str(page1.request.get(base + "/user/" + a + "/api/contents/shared.ipynb").json().get("content", {})), 30)
            page1.reload(); page1.locator(".jp-DirListing").wait_for(timeout=60000)
            page1.wait_for_function("document.querySelector('.jp-Notebook .cm-content')?.textContent.includes('uid-check')", timeout=30000)
            browser.close()

    def test_05_single_lab_keeps_legacy_file_browser_and_kernel(self):
        from playwright.sync_api import sync_playwright
        import start as startup
        legacy = Path(self.temp.name) / "legacy"
        with patch.dict(os.environ, {"JUPYTER_TOKEN": "qa-legacy-only", "ARENA_JUPYTER_MODE": "single"}):
            command = startup.launch_plan(legacy, "jupyter")[0]
            command[0] = "/opt/arena/venv/bin/jupyter"
            command = [arg.replace("--port=8888", "--port=8899") for arg in command]
            process = subprocess.Popen(command, env=dict(os.environ), stdout=self.log, stderr=self.log, start_new_session=True)
        base = "http://127.0.0.1:8899"
        try:
            self.wait(lambda: httpx.get(base + "/api/status", timeout=3).status_code == 200, 60)
            body = {"type": "notebook", "content": {"nbformat": 4, "nbformat_minor": 5, "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"}}, "cells": [{"cell_type": "code", "metadata": {}, "source": "print('legacy-kernel-ok')", "outputs": [], "execution_count": None}]}}
            response = httpx.put(base + "/api/contents/compat.ipynb", headers={"Authorization": "token qa-legacy-only"}, json=body, timeout=10)
            self.assertIn(response.status_code, (200, 201))
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
                page = browser.new_page()
                page.on("pageerror", lambda error: print("Legacy browser error:", str(error)))
                page.on("console", lambda message: print("Legacy console:", message.text[-500:]) if message.type == "error" else None)
                page.on("response", lambda response: print("Legacy HTTP error:", response.status, urlparse(response.url).path) if response.status >= 400 else None)
                page.goto(base + "/lab?token=qa-legacy-only")
                page.locator(".jp-DirListing-item").filter(has_text="compat.ipynb").dblclick(timeout=60000)
                editor = page.locator(".jp-Notebook .jp-CodeCell .cm-content").first
                try:
                    editor.wait_for(timeout=30000)
                    # The editor appears before the document/session is fully
                    # initialized. Execute only after the real kernel is idle.
                    page.wait_for_function("document.body.innerText.includes(' | Idle')", timeout=60000)
                    editor.click(); editor.press("Shift+Enter")
                    page.locator(".jp-OutputArea-output").get_by_text("legacy-kernel-ok", exact=False).first.wait_for(timeout=30000)
                except Exception:
                    print("Legacy diagnostics:", page.evaluate("""() => { const c=JSON.parse(document.getElementById('jupyter-config-data').textContent); return {disabled:c.disabledExtensions, body:document.body.innerText.slice(-2500)} }"""))
                    self.log.flush()
                    logs = (Path(self.temp.name) / "hub.log").read_text(errors="replace").splitlines()
                    print("\n".join(line for line in logs if any(term in line for term in ("8899", "Kernel", "Error", "Traceback")))[-5000:])
                    raise
                browser.close()
        finally:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL); process.wait()

    def test_06_admission_and_spawn_failure_preserve_running_teams(self):
        new_team = {"teamId": str(uuid.uuid4()), "teamName": "Waiting team", "enabled": True,
                    "desiredState": "running", "revision": str(uuid.uuid4())}
        policy = {**self.policy, "hub": {**self.policy["hub"], "teams": self.teams + [new_team]}}
        for measured in ({"availableRAMGiB": 3, "freeDiskGiB": 20},
                         {"availableRAMGiB": None, "freeDiskGiB": 20},
                         {"availableRAMGiB": 20, "freeDiskGiB": 1}):
            with patch("hub_runtime.resources", return_value=measured):
                report = self.manager.reconcile(policy)
            self.assertTrue(self.all_ready(report, 4))
            self.assertEqual(report["notebooks"][-1]["state"], "waiting-resource")
        full = {**policy, "hub": {**policy["hub"], "maxTeamServers": 4}}
        self.assertEqual(self.manager.reconcile(full)["notebooks"][-1]["state"], "waiting-resource")
        original = self.manager.ensure_user
        def fail_new(team_id):
            if team_id == new_team["teamId"]:
                raise RuntimeError("QA injected isolated preparation error")
            return original(team_id)
        with patch.object(self.manager, "ensure_user", side_effect=fail_new):
            report = self.manager.reconcile(policy)
        self.assertTrue(self.all_ready(report, 4))
        self.assertEqual(report["notebooks"][-1]["state"], "error")
        self.manager.reconcile(self.policy)

    def test_07_volume_restores_accounts_hub_files_and_venvs(self):
        cls = type(self)
        team = self.team_ids[0]
        user = self.manager.ensure_user(team)
        self.assertEqual(self.run_team(team, "open('restart-check.txt','w').write('saved')").returncode, 0)
        cls.process.terminate()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            # A stopped/replaced Pod can lose processes before Hub's graceful
            # cleanup finishes. Recovery must work after that abrupt stop too.
            os.killpg(cls.process.pid, signal.SIGKILL)
            cls.process.wait()
        before = {k: dict(v) for k, v in self.manager.users.items()}
        # Recreate the ephemeral container account database, retaining the volume.
        for account in before.values():
            subprocess.run(["pkill", "-KILL", "-u", str(account["uid"])], check=False)
            subprocess.run(["userdel", account["name"]], check=True)
            subprocess.run(["groupdel", account["name"]], check=False, capture_output=True)
        cls.manager = HubManager(cls.root)
        for team_id, old in before.items():
            restored = cls.manager.ensure_user(team_id)
            self.assertEqual(restored["uid"], old["uid"])
        cls.process = subprocess.Popen(["/opt/arena/hub-venv/bin/jupyterhub", "--config=/opt/arena/hub_config.py"],
                                       env=cls.hub_env, cwd=cls.root, stdout=cls.log, stderr=cls.log, start_new_session=True)
        self.wait(lambda: cls.manager.hub_request("GET", "/info"), 60)
        self.wait(lambda: self.all_ready(cls.manager.reconcile(cls.policy), 4), 150)
        self.assertEqual(self.run_team(team, "from pathlib import Path; assert Path('restart-check.txt').read_text()=='saved'; assert Path('.venvs/pytorch/bin/python').exists()").returncode, 0)
        self.assertIn("uid-check", (Path(user["home"]) / "shared.ipynb").read_text())
        self.assertEqual(cls.manager.ensure_user(team)["uid"], user["uid"])

    def test_08_remapped_nfs_writes_as_team_without_chown_or_root_home_reads(self):
        team = str(uuid.uuid4())
        home = self.manager.teams_root / team
        # Failed legacy chown leaves this exact empty root-owned directory.
        home.mkdir(mode=0o700)
        original_stat, original_open, original_chown = Path.stat, Path.open, os.chown
        def inside_home(path):
            return os.geteuid() == 0 and home in path.parents
        def nfs_stat(path, *args, **kwargs):
            if inside_home(path):
                raise PermissionError(13, "QA NFS denies root traversal")
            return original_stat(path, *args, **kwargs)
        def nfs_open(path, *args, **kwargs):
            if inside_home(path):
                raise PermissionError(13, "QA NFS denies root reads")
            return original_open(path, *args, **kwargs)
        def nfs_chown(path, uid, gid, *args, **kwargs):
            if uid != 0 or gid != 0:
                raise PermissionError(1, "QA NFS denies chown")
            return original_chown(path, uid, gid, *args, **kwargs)
        source = self.manager.control / "nfs-starter.py"
        source.write_text("print('private team starter')")
        with patch("hub_runtime.os.chown", side_effect=nfs_chown), \
             patch("hub_runtime.os.fchown", side_effect=PermissionError(1, "QA NFS denies fchown")), \
             patch.object(Path, "stat", nfs_stat), patch.object(Path, "open", nfs_open):
            user = self.manager.ensure_user(team)
            TeamFiles(home, user["uid"], user["uid"]).install("Tac_vu_1/starter.py", source)
            self.assertEqual(self.manager.ensure_user(team)["uid"], user["uid"])
        self.assertEqual(home.stat().st_uid, user["uid"])
        self.assertEqual(home.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.run_team(team, "from pathlib import Path; assert Path('Tac_vu_1/starter.py').read_text().startswith('print'); open('checkpoint.txt','w').write('saved')").returncode, 0)
        other = self.team_ids[0]
        self.assertNotEqual(self.run_team(other, f"open({str(home / 'checkpoint.txt')!r}).read()").returncode, 0)
        # Preserve a nonempty root-owned home rather than moving/deleting work.
        blocked = str(uuid.uuid4())
        blocked_home = self.manager.teams_root / blocked
        blocked_home.mkdir(mode=0o700)
        (blocked_home / "keep.txt").write_text("existing work")
        with self.assertRaisesRegex(RuntimeError, "files preserved"):
            self.manager.ensure_user(blocked)
        self.assertEqual((blocked_home / "keep.txt").read_text(), "existing work")

    def test_09_cookie_secret_uses_strict_local_copy_and_preserves_persisted_key(self):
        source = self.manager.control / "cookie-secret"
        value = source.read_text()
        source.chmod(0o666)
        original_chmod = Path.chmod
        def nfs_chmod(path, mode, *args, **kwargs):
            if path == source:
                return  # Simulate NFS ignoring the requested leaf mode.
            return original_chmod(path, mode, *args, **kwargs)
        with patch.object(Path, "chmod", nfs_chmod):
            restored = HubManager(self.root)
        local = restored.runtime / "cookie-secret"
        self.assertEqual(source.stat().st_mode & 0o777, 0o666)
        self.assertEqual(local.stat().st_mode & 0o777, 0o600)
        self.assertEqual(local.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(local.read_text(), value)
        self.assertEqual(source.read_text(), value)
        for team in self.team_ids[:2]:
            self.assertNotEqual(self.run_team(team, f"open({str(source)!r}).read()").returncode, 0)
            self.assertNotEqual(self.run_team(team, f"open({str(local)!r}).read()").returncode, 0)
        source.chmod(0o600)
        # Reject a corrupt persisted key, rather than silently logging users
        # out by rotating it during a restart.
        source.write_text("corrupt")
        try:
            with self.assertRaisesRegex(ValueError, "refusing to rotate"):
                HubManager(self.root)
            self.assertEqual(source.read_text(), "corrupt")
        finally:
            source.write_text(value)
            HubManager(self.root)

    def test_10_cold_start_creates_private_control_when_nfs_ignores_chmod(self):
        cold_root = Path(self.temp.name) / "cold-workspace"
        cold_root.mkdir()
        cold_root.chmod(0o777)
        runtime = Path(self.temp.name) / "cold-runtime"
        original_chmod, original_mkdir, original_chown = Path.chmod, Path.mkdir, os.chown
        def on_volume(path):
            return path == cold_root or cold_root in path.parents
        def nfs_mkdir(path, *args, **kwargs):
            result = original_mkdir(path, *args, **kwargs)
            if on_volume(path) and path.stat().st_uid == 0:
                original_chmod(path, 0o777)
            return result
        def nfs_chmod(path, mode, *args, **kwargs):
            if on_volume(path) and path.stat().st_uid == 0:
                return
            return original_chmod(path, mode, *args, **kwargs)
        def nfs_chown(path, uid, gid, *args, **kwargs):
            if on_volume(Path(path)) and uid != 0:
                raise PermissionError(1, "QA remapped NFS denies root chown")
            return original_chown(path, uid, gid, *args, **kwargs)
        with patch.object(Path, "mkdir", nfs_mkdir), patch.object(Path, "chmod", nfs_chmod), patch("hub_runtime.os.chown", nfs_chown), patch.dict(os.environ, {
            "ARENA_JUPYTER_MODE": "team-hub",
            "ARENA_HUB_RUNTIME_ROOT": str(runtime),
        }):
            startup.prepare_root(cold_root)
            plan = startup.launch_plan(cold_root, "jupyter")
            self.assertIn("jupyterhub", plan[0][0])
            self.assertEqual(plan[1][0], "uvicorn")
            manager = startup.HUB_BOOT_MANAGER
            self.assertFalse((cold_root / ".arena").exists())
            for path in (runtime, manager.control):
                self.assertEqual(path.stat().st_uid, 0)
                self.assertEqual(path.stat().st_mode & 0o777, 0o700)
                for team in self.team_ids[:2]:
                    self.assertNotEqual(self.run_team(team, f"__import__('os').listdir({str(path)!r})").returncode, 0)
            self.assertEqual((manager.control / "cookie-secret").stat().st_mode & 0o777, 0o600)
            blob = manager.state.path.read_bytes()
            self.assertNotIn(self.token.encode(), blob)
            self.assertNotIn((manager.control / "cookie-secret").read_bytes(), blob)
            self.assertEqual(manager.volume_cache.stat().st_uid, DATA_UID)
            self.assertEqual(manager.volume_cache.stat().st_mode & 0o777, 0o700)
        startup.HUB_BOOT_MANAGER = None

    def test_11_encrypted_checkpoint_restores_and_rejects_tamper_and_wrong_binding(self):
        root = Path(self.temp.name) / "encrypted-volume"
        root.mkdir(); root.chmod(0o777)
        runtime = Path(self.temp.name) / "encrypted-runtime"
        identity = str(uuid.uuid4())
        user = None
        with patch.dict(os.environ, {"ARENA_WORKSPACE_ID": identity, "ARENA_HUB_RUNTIME_ROOT": str(runtime)}):
            manager = HubManager(root)
            try:
                team = str(uuid.uuid4())
                user = manager.ensure_user(team)
                value = (manager.control / "cookie-secret").read_bytes()
                (manager.control / "policy.json").write_text('{"active":true,"assets":["do-not-restore-old-gate"]}')
                import sqlite3
                with sqlite3.connect(manager.control / "hub.sqlite") as database:
                    database.execute("CREATE TABLE durable(value TEXT)")
                    database.execute("INSERT INTO durable VALUES ('saved')")
                manager.state.flush()
                blob = manager.state.path.read_bytes()
                manager.state.path.chmod(0o777)  # Untrusted, world-readable NFS.
                self.assertNotIn(value, blob)
                self.assertNotIn(self.token.encode(), blob)
                shutil.rmtree(runtime)
                restored = HubManager(root)
                self.assertEqual(restored.ensure_user(team)["uid"], user["uid"])
                self.assertEqual((restored.control / "cookie-secret").read_bytes(), value)
                self.assertFalse((restored.control / "policy.json").exists())
                with sqlite3.connect(restored.control / "hub.sqlite") as database:
                    self.assertEqual(database.execute("SELECT value FROM durable").fetchone()[0], "saved")
                valid = manager.state.path.read_bytes()
                shutil.rmtree(runtime)
                tampered = valid[:-1] + bytes([valid[-1] ^ 1])
                manager.state.path.write_bytes(tampered)
                with self.assertRaisesRegex(ValueError, "Encrypted Hub state is invalid"):
                    HubManager(root)
                self.assertEqual(manager.state.path.read_bytes(), tampered)
                manager.state.path.write_bytes(valid)
                with patch.dict(os.environ, {"ARENA_WORKSPACE_ID": str(uuid.uuid4()), "ARENA_HUB_RUNTIME_ROOT": str(runtime.parent / "wrong-binding")}):
                    with self.assertRaisesRegex(ValueError, "Encrypted Hub state is invalid"):
                        HubManager(root)
                self.assertEqual(HubManager(root).ensure_user(team)["uid"], user["uid"])
            finally:
                if user:
                    subprocess.run(["userdel", user["name"]], check=False)
                    subprocess.run(["groupdel", user["name"]], check=False, capture_output=True)

    def test_12_asset_descriptor_works_when_root_cannot_traverse_private_volume_cache(self):
        archive = Path(self.temp.name) / "descriptor.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("Tac_vu_2/dataset/train/x.csv", "id\n2\n")
            bundle.writestr("Tac_vu_2/baseline.ipynb", "{}")
        asset = {"sha256": "d" * 64, "phase": "public", "workspaceLayout": "task-root"}
        policy = {**self.policy, "assets": [asset]}
        code = """import os,sys
from pathlib import Path
from agent import safe_extract
fd=int(sys.argv[1]); source=Path('/proc/self/fd')/str(fd)
try: os.listdir(os.readlink(source))
except PermissionError: pass
else: raise AssertionError('Root DAC override was not removed')
safe_extract(Path(sys.argv[2]), source, task_root=True)
"""
        def loader(_asset, source):
            fd = int(source.name)
            result = subprocess.run(["setpriv", "--bounding-set=-dac_override,-dac_read_search", "/opt/arena/venv/bin/python", "-c", code, str(fd), str(archive)],
                                    pass_fds=(fd,), cwd="/opt/arena", capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr[-1000:])
        self.manager.cache_asset(asset, loader, lambda: policy)
        self.manager.install_assets(self.team_ids[0], policy)
        self.assertEqual(self.run_team(self.team_ids[0], "from pathlib import Path; assert Path('Tac_vu_2/dataset/train/x.csv').read_text()=='id\\n2\\n'").returncode, 0)

    def test_13_home_activation_rejects_an_entry_injected_before_lockdown(self):
        team_id = str(uuid.uuid4())
        owner = self.manager.ensure_user(self.team_ids[0])
        stage, fd = data_request(self.root, "home-stage", want_fd=True)
        home = self.manager.teams_root / team_id
        files = TeamFiles(home, owner["uid"], owner["uid"])
        try:
            files.run("create-home", parent_fd=fd, pass_fds=(fd,))
            data_request(self.root, "home-publish", team_id=team_id, stage=stage["stage"])
        finally:
            os.close(fd)
            data_request(self.root, "stage-clean", stage=stage["stage"])
        self.assertEqual(self.run_team(self.team_ids[1], f"open({str(home / 'injected.py')!r},'w').write('must not execute')").returncode, 0)
        with self.assertRaises(ValueError):
            files.run("activate-home")
        self.assertEqual(home.stat().st_mode & 0o777, 0o700)
        self.assertFalse(data_request(self.root, "home-status", team_id=team_id, uid=owner["uid"])["activated"])
        self.assertTrue((home / "injected.py").exists())

    def test_14_unprivileged_https_download_checksum_readonly_publish_and_cache_cleanup(self):
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as bundle:
            bundle.writestr("Tac_vu_3/dataset/train/y.csv", "id\n3\n")
            bundle.writestr("Tac_vu_3/baseline.ipynb", "{}")
        body = stream.getvalue()
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Arena local QA")])
        now = datetime.datetime.now(datetime.timezone.utc)
        certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(private.public_key())
                       .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
                       .not_valid_after(now + datetime.timedelta(days=1))
                       .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
                       .sign(private, hashes.SHA256()))
        cert, key = Path(self.temp.name) / "qa-ca.pem", Path(self.temp.name) / "qa-tls-key.pem"
        cert.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
        key.write_bytes(private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        cert.chmod(0o644); key.chmod(0o600)
        calls = []
        class Archive(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                calls.append(1)
                self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Archive)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        digest = hashlib.sha256(body).hexdigest()
        asset = {"sha256": digest, "phase": "public", "workspaceLayout": "task-root", "bytes": len(body), "name": "tls-fixture.zip",
                 "url": "https://127.0.0.1:" + str(server.server_address[1]) + "/dataset.zip"}
        policy = {**self.policy, "assets": [asset]}
        try:
            with patch.dict(os.environ, {"SSL_CERT_FILE": str(cert)}):
                self.manager.cache_asset(asset, None, lambda: policy)
                self.manager.cache_asset(asset, None, lambda: policy)
            self.assertEqual(len(calls), 1)
            self.assertFalse((self.manager.volume_cache / digest).exists())
            target = self.manager.shared / digest / "Tac_vu_3/dataset/train/y.csv"
            self.assertEqual(target.stat().st_uid, DATA_UID)
            self.assertEqual(target.stat().st_mode & 0o777, 0o444)
            self.manager.install_assets(self.team_ids[0], policy)
            self.assertEqual(self.run_team(self.team_ids[0], "from pathlib import Path; assert Path('Tac_vu_3/dataset/train/y.csv').read_text()=='id\\n3\\n'").returncode, 0)
            self.assertNotEqual(self.run_team(self.team_ids[0], "open('Tac_vu_3/dataset/train/y.csv','w').write('bad')").returncode, 0)
        finally:
            server.shutdown(); server.server_close()
            key.unlink(missing_ok=True); cert.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
