/** Read-only feature smoke check; never allocates a Pod or changes a round. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
async function main() {
  const base = "https://olpai-mock-arena.vercel.app";
  assert.equal((await fetch(base + "/login")).status, 200);
  assert.equal((await fetch(base + "/api/workspace/state")).status, 401);
  const access = await readFile("ACCESS.local.md", "utf8");
  const password = access.match(/Mật khẩu ban đầu: (.+)/)?.[1];
  assert.ok(password, "Missing local admin access file");
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "arena_admin", password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  try {
    const response = await fetch(base + "/api/workspace/state", {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.encryptionReady, true);
    assert.ok(
      state.defaultTemplate.imageName.startsWith(
        "nguyenlong26/olpai-workspace",
      ),
    );
    assert.ok(Array.isArray(state.templates) && Array.isArray(state.teams));
    const hubImage = process.argv
      .find((v) => v.startsWith("--hub-image="))
      ?.slice(12);
    if (hubImage) {
      assert.equal(state.defaultTemplate.imageName, hubImage);
      const hubs = state.templates.filter(
        (t: { jupyterMode?: string }) => t.jupyterMode === "team-hub",
      );
      assert.ok(hubs.length, "Shared Hub template is missing");
      for (const hub of hubs) {
        assert.equal(hub.services, "jupyter");
        const capacity = hub.maxTeamServers ?? 7;
        assert.ok(Number.isInteger(capacity) && capacity >= 1 && capacity <= 32);
        assert.equal(hub.imageName, hubImage);
      }
    }
    for (const workspace of state.workspaces) {
      assert.equal("secret" in workspace, false);
      assert.equal("jupyterSecret" in workspace, false);
      assert.equal("ownerId" in workspace, false);
    }
    console.log(
      "PASS production: login/session, protected Workspace API, encryption configuration, image default and secret-free response. No Pod allocated.",
    );
  } finally {
    await fetch(base + "/api/auth/logout", {
      method: "POST",
      headers: { Origin: base, Cookie: cookie },
    });
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Smoke check failed");
  process.exitCode = 1;
});
