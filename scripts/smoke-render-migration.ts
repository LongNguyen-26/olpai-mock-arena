/** Login/read/logout only. Never provisions a Pod, submits, seeds, or changes rounds. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { arenaBaseUrl } from "./arena-url";

async function main() {
  const base = arenaBaseUrl();
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(base + path, {
      ...init, redirect: "manual", signal: AbortSignal.timeout(90_000),
    });
    assert.ok(response.status < 300 || response.status >= 400,
      "Unexpected redirect at " + path.split("?")[0]);
    return response;
  };
  const page = await request("/login");
  assert.equal(page.status, 200, "Login page");
  assert.ok(page.headers.has("rndr-id"), "Expected Render response");
  assert.equal(page.headers.has("x-vercel-id"), false);
  assert.ok((await page.text()).includes("<title>OlpAI Arena</title>"));
  assert.equal((await request("/")).status, 200, "Guest homepage");
  const publicResponse = await request("/api/arena");
  assert.equal(publicResponse.status, 200, "Public round catalogue");
  const publicCatalogue = await publicResponse.json();
  assert.equal(publicCatalogue.user, null);
  for (const name of ["assets", "submissions", "invites", "registrations", "teams", "packages"]) assert.deepEqual(publicCatalogue[name], []);
  for (const round of publicCatalogue.rounds) {
    const response = await request("/api/arena?round=" + encodeURIComponent(round.id));
    assert.equal(response.status, 200);
    const guest = await response.json();
    assert.equal(guest.user, null); assert.equal(guest.team, null);
    for (const name of ["assets", "submissions", "invites", "registrations", "teams", "packages"]) assert.deepEqual(guest[name], []);
    assert.equal((await request("/api/statement?round=" + encodeURIComponent(round.id))).status, guest.canReadStatement ? 200 : 403);
    assert.equal((await request("/api/download?round=" + encodeURIComponent(round.id) + "&asset=guest-probe")).status, 401);
  }
  assert.equal((await request("/api/workspace/state")).status, 401);
  if (process.argv.includes("--require-health")) {
    const health = await request("/api/health");
    assert.equal(health.status, 200, "Process health");
    assert.equal((await health.json()).ok, true);
  }
  const password = (await readFile("ACCESS.local.md", "utf8"))
    .match(/Mật khẩu ban đầu: (.+)/)?.[1]?.trim();
  assert.ok(password, "Local admin access unavailable");
  const login = await request("/api/auth/login", {
    method: "POST", headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "arena_admin", password }),
  });
  assert.equal(login.status, 200, "Admin login through Render proxy");
  const session = login.headers.get("set-cookie");
  assert.ok(session && /httponly/i.test(session) && /secure/i.test(session));
  const cookie = session.split(";")[0];
  try {
    const read = async (path: string) => {
      const res = await request(path, { headers: { Cookie: cookie } });
      assert.equal(res.status, 200, path.split("?")[0]);
      return res.json();
    };
    const catalog = await read("/api/arena");
    assert.equal(catalog.user.admin, true);
    for (const round of catalog.rounds) {
      const snapshot = await read("/api/arena?round=" + encodeURIComponent(round.id));
      assert.equal(snapshot.contest.roundId ?? snapshot.contest.id, round.id);
      assert.ok(Array.isArray(snapshot.submissions));
      const statement = await read("/api/statement?round=" + encodeURIComponent(round.id));
      assert.ok(Array.isArray(statement.tasks) && statement.tasks.length > 0);
    }
    const workspace = await read("/api/workspace/state");
    assert.equal(workspace.encryptionReady, true, "Encryption key configured (length check)");
    for (const w of workspace.workspaces) for (const key of ["secret", "jupyterSecret", "ownerId"]) {
      assert.equal(key in w, false);
    }
    let checkedConfigurations = 0;
    for (const w of workspace.workspaces.filter((w: { manual?: { state?: string } }) =>
      ["prepared", "verifying"].includes(w.manual?.state ?? ""))) {
      const response = await request("/api/workspace/manual/config?id=" + encodeURIComponent(w.id), { headers: { Cookie: cookie } });
      if (response.status === 403) continue; // Another admin owns this record.
      assert.equal(response.status, 200, "Read prepared manual configuration");
      const config = await response.json();
      const callback = new URL(config.environment.ARENA_CONTROL_URL);
      assert.ok(["olpaiarena.cyou", "olpai-arena.onrender.com"].includes(callback.hostname), "Callback must reach the active Render service");
      checkedConfigurations++;
    }
    // Reading GPU prices decrypts the existing admin credential, without allocating a Pod.
    if (workspace.runpodMode === "disabled") {
      const prices = await request("/api/workspace/prices", { headers: { Cookie: cookie } });
      assert.equal(prices.status, 503, "Runpod is intentionally disabled");
      assert.equal((await request("/api/workspace/groq/credential", { headers: { Cookie: cookie } })).status, 200, "Groq configuration independent of Runpod");
    } else if (workspace.hasCredential) {
      const prices = await request("/api/workspace/prices", { headers: { Cookie: cookie } });
      assert.equal(prices.status, 200, "Stored Runpod credential works on Render");
    }
    console.log(JSON.stringify({
      result: "PASS", base, render: true, login: true, publicBrowsing: true, protectedApis: true,
      roundCount: catalog.rounds.length, workspaceCount: workspace.workspaces.length,
      ownedManualConfigurationsDecrypted: checkedConfigurations,
      runpodMode: workspace.runpodMode ?? "enabled",
      storedRunpodCredentialVerified: workspace.runpodMode !== "disabled" && !!workspace.hasCredential,
      activeWorkspaceCount: workspace.workspaces.filter((w: { status: string }) => !["terminated", "failed"].includes(w.status)).length,
      actualPodEnvironmentInspected: false, podOrRoundMutations: 0,
    }));
  } finally {
    assert.equal((await request("/api/auth/logout", {
      method: "POST", headers: { Cookie: cookie, Origin: base },
    })).status, 200, "Logout");
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Render smoke failed");
  process.exitCode = 1;
});
