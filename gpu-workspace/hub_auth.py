"""Arena SSO: browser nonce and a one-use server-verified ticket."""
import hmac
import json
import os
import re
import secrets
from urllib.parse import urlencode, urlparse

import httpx
from jupyterhub.auth import Authenticator
from jupyterhub.handlers import BaseHandler
from jupyterhub.utils import url_path_join
from tornado.web import HTTPError


class ArenaLoginHandler(BaseHandler):
    async def get(self):
        self.set_header("Cache-Control", "no-store")
        self.set_header("Referrer-Policy", "no-referrer")
        ticket = self.get_argument("ticket", "")
        if not ticket:
            state = secrets.token_urlsafe(32)
            self.set_secure_cookie("arena-state-" + state, state, expires_days=10/1440,
                                   httponly=True, secure=os.getenv("ARENA_TEST_HTTP") != "1",
                                   samesite="Lax", path=self.request.path)
            query = {"id": os.environ["ARENA_WORKSPACE_ID"], "state": state}
            team_id = self.get_argument("teamId", "")
            if team_id:
                query["teamId"] = team_id
            control = os.environ["ARENA_CONTROL_URL"].rsplit("/manifest", 1)[0]
            parsed = urlparse(control)
            canonical = parsed.scheme + "://" + parsed.netloc
            allowed = json.loads(os.getenv("ARENA_LOGIN_ORIGINS", json.dumps([canonical])))
            origin = self.get_argument("arenaOrigin", canonical)
            if origin not in allowed:
                raise HTTPError(403, "Use the configured Arena address")
            self.redirect(origin + "/api/workspace/hub/authorize?" + urlencode(query))
            return
        state = self.get_argument("state", "")
        saved = self.get_secure_cookie("arena-state-" + state, max_age_days=10/1440)
        if not saved or not hmac.compare_digest(saved.decode(), state):
            raise HTTPError(403, "Restart login from Arena")
        self.clear_cookie("arena-state-" + state, path=self.request.path)
        user = await self.login_user({"ticket": ticket, "state": state})
        if user is None:
            raise HTTPError(403, "Login ticket expired")
        self.redirect("/user/" + user.name + "/lab")


class ArenaAuthenticator(Authenticator):
    auto_login = True

    def login_url(self, base_url):
        return url_path_join(base_url, "arena-login")

    def get_handlers(self, app):
        return [(r"/arena-login", ArenaLoginHandler)]

    async def authenticate(self, handler, data):
        if not re.fullmatch(r"[\w-]{43}", data.get("ticket", "")):
            return None
        control = os.environ["ARENA_CONTROL_URL"].rsplit("/manifest", 1)[0]
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
                response = await client.post(control + "/hub/redeem", json={
                    "id": os.environ["ARENA_WORKSPACE_ID"], "ticket": data["ticket"], "state": data["state"]},
                    headers={"Authorization": "Bearer " + os.environ["ARENA_AGENT_TOKEN"]})
                response.raise_for_status()
                name = response.json()["username"]
                if not re.fullmatch(r"t[a-f0-9]{24}", name):
                    return None
                return {"name": name, "admin": False}
        except (httpx.HTTPError, ValueError, KeyError):
            return None

    def check_allowed(self, username, authentication=None):
        return bool(authentication and re.fullmatch(r"t[a-f0-9]{24}", username))
