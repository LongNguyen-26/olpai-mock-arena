"""Real Linux UID/Hub/kernel/RTC tests. CPU only; all Arena traffic is local."""
import json
import os
import secrets
import signal
import subprocess
import tempfile
import threading
import time
import unittest
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
from hub_runtime import HubManager, TeamFiles, username


@unittest.skipUnless(os.name == "posix" and hasattr(os, "geteuid") and os.geteuid() == 0,
                     "requires disposable Linux runner with root")
class LinuxHubTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="arena-hub-")
        Path(cls.temp.name).chmod(0o755)
        cls.root = Path(cls.temp.name) / "workspace"
        cls.root.mkdir()
        cls.manager = HubManager(cls.root)
        cls.manager.check_privileges()
        cls.team_ids = [str(uuid.uuid4()) for _ in range(4)]
        cls.teams = [{"teamId": i, "teamName": "QA " + str(n), "enabled": True, "desiredState": "running", "revision": str(uuid.uuid4())} for n, i in enumerate(cls.team_ids)]
        cls.policy = {"active": True, "runId": str(uuid.uuid4()), "privateLocked": True, "assets": [], "hub": {"teams": cls.teams[:3], "maxTeamServers": 7}}
        cls.tickets = {}
        cls.token = "qa-fake-arena-agent-secret"

        class Arena(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                query = parse_qs(urlparse(self.path).query)
                if urlparse(self.path).path.endswith("/hub/authorize"):
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
        env = {**os.environ, "ARENA_WORKSPACE_ROOT": str(cls.root), "ARENA_WORKSPACE_ID": str(uuid.uuid4()),
               "ARENA_CONTROL_URL": "http://127.0.0.1:19090/api/workspace/manifest", "ARENA_AGENT_TOKEN": cls.token,
               "ARENA_TEST_HTTP": "1", "PYTHONPATH": "/opt/arena", "ARENA_MAX_TEAM_SERVERS": "7"}
        env.pop("RUNPOD_POD_ID", None)
        cls.log = open(Path(cls.temp.name) / "hub.log", "wb")
        cls.process = subprocess.Popen(["/opt/arena/hub-venv/bin/jupyterhub", "--config=/opt/arena/hub_config.py"], env=env, stdout=cls.log, stderr=cls.log, start_new_session=True)
        try:
            cls.wait(lambda: cls.manager.hub_request("GET", "/info"), 60)
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
        cls.arena.shutdown(); cls.arena.server_close(); cls.log.close()
        for item in cls.manager.users.values():
            subprocess.run(["pkill", "-KILL", "-u", str(item["uid"])], check=False)
            subprocess.run(["userdel", item["name"]], check=False)
            subprocess.run(["groupdel", item["name"]], check=False, capture_output=True)
        cls.temp.cleanup()

    def run_team(self, team_id, script):
        user = self.manager.ensure_user(team_id)
        return subprocess.run([str(Path(user["home"]) / ".venvs/pytorch/bin/python"), "-c", script],
                              env={"HOME": user["home"], "PATH": "/usr/bin:/bin"}, cwd=user["home"],
                              user=user["uid"], group=user["uid"], extra_groups=[], capture_output=True, text=True, timeout=20)

    def test_01_files_uid_and_secret_isolation(self):
        a, b = self.team_ids[:2]
        a_user = self.manager.ensure_user(a)
        self.assertEqual(self.run_team(a, "import os; assert os.geteuid()!=0").returncode, 0)
        secret = self.manager.control / "service-token"
        self.assertNotEqual(self.run_team(a, f"open({str(secret)!r}).read()").returncode, 0)
        Path(a_user["home"], "private.txt").write_text("team A")
        self.assertNotEqual(self.run_team(b, f"open({str(Path(a_user['home']) / 'private.txt')!r}).read()").returncode, 0)
        again = HubManager(self.root).ensure_user(a)
        self.assertEqual(again["uid"], a_user["uid"])

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
            for page, team in ((page1, self.team_ids[0]), (page2, self.team_ids[0]), (page3, self.team_ids[1])):
                page.goto(base + "/hub/arena-login?teamId=" + team)
                page.locator(".jp-DirListing").wait_for(timeout=60000)
            response = page1.evaluate("""async (base) => {
                const token = document.cookie.split('; ').find(x => x.startsWith('_xsrf='))?.split('=').slice(1).join('=');
                const r = await fetch(base+'/api/contents/shared.ipynb', {method:'PUT', headers:{'Content-Type':'application/json','X-XSRFToken':decodeURIComponent(token||'')}, body:JSON.stringify({type:'notebook',content:{nbformat:4,nbformat_minor:5,metadata:{},cells:[{cell_type:'code',execution_count:null,metadata:{},outputs:[],source:''}]}})});
                return r.status;
            }""", "/user/" + a)
            self.assertIn(response, (200, 201))
            for page in (page1, page2):
                page.goto(base + "/user/" + a + "/lab/tree/shared.ipynb")
                page.locator(".jp-Notebook .jp-CodeCell .cm-content").first.wait_for(timeout=60000)
            editor = page1.locator(".jp-Notebook .jp-CodeCell .cm-content").first
            editor.click()
            editor.press_sequentially("print('rtc-shared')", delay=15)
            try:
                page2.wait_for_function("document.querySelector('.jp-Notebook .cm-content')?.textContent.includes('rtc-shared')")
            except Exception:
                for client in (page1, page2):
                    print("RTC diagnostics", client.evaluate("""() => { const c=JSON.parse(document.getElementById('jupyter-config-data').textContent); return {collaborative:c.collaborative,disabled:c.disabledExtensions,extensions:c.federated_extensions?.map(x=>x.name),text:document.querySelector('.jp-Notebook .cm-content')?.textContent} }"""))
                self.log.flush()
                print((Path(self.temp.name) / "hub.log").read_text(errors="replace")[-7000:])
                raise
            second = page2.locator(".jp-Notebook .jp-CodeCell .cm-content").first
            second.click(); second.press("ControlOrMeta+End"); second.press("Enter"); second.press_sequentially("print('second-client')", delay=15)
            page1.wait_for_function("document.querySelector('.jp-Notebook .cm-content')?.textContent.includes('second-client')")
            editor.press("Shift+Enter")
            page1.get_by_text("rtc-shared\nsecond-client", exact=False).first.wait_for(timeout=60000)
            self.assertIn(page3.request.get(base + "/user/" + a + "/api/contents").status, (401, 403, 404))
            # Execute through the actual browser kernel; root credentials must be absent.
            editor = page1.locator(".jp-Notebook .jp-CodeCell .cm-content").first
            editor.click(); editor.press("ControlOrMeta+A")
            editor.press_sequentially("import os, sys\nprint('uid-check', os.geteuid() != 0, 'ARENA_AGENT_TOKEN' not in os.environ, 'CONFIGPROXY_AUTH_TOKEN' not in os.environ)\nprint('venv-check', '.venvs/pytorch' in sys.prefix)")
            editor.press("Shift+Enter")
            page1.get_by_text("uid-check True True True", exact=False).first.wait_for(timeout=30000)
            page1.get_by_text("venv-check True", exact=False).first.wait_for(timeout=30000)
            page1.reload(); page1.locator(".jp-DirListing").wait_for(timeout=60000)
            browser.close()


if __name__ == "__main__":
    unittest.main()
