/** Read-only verification on both hosting providers; never creates a round or Pod. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

async function main() {
  const root = "../statements/Arena_04/web_ready/release_20261030";
  const pkg = JSON.parse(await readFile(root + "/handoff/package-config.json", "utf8"));
  const access = await readFile("ACCESS.local.md", "utf8");
  const password = access.match(/Mật khẩu ban đầu: (.+)/)?.[1];
  assert.ok(password, "Local admin access unavailable");
  const results = [];
  for (const base of ["https://olpai-arena.onrender.com", "https://olpai-mock-arena.vercel.app"]) {
    const request = (path: string, init?: RequestInit) => fetch(base + path, { ...init, signal: AbortSignal.timeout(60_000) });
    assert.equal((await request("/login")).status, 200);
    assert.equal((await request("/api/arena")).status, 401);
    const login = await request("/api/auth/login", {
      method: "POST", headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "arena_admin", password }),
    });
    assert.equal(login.status, 200, "Admin login failed at " + base);
    const cookie = login.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
    try {
      const res = await request("/api/arena", { headers: { Cookie: cookie } });
      assert.equal(res.status, 200);
      const state = await res.json();
      assert.equal(state.user.admin, true);
      assert.ok(JSON.stringify(state.packages).includes(pkg.version), "Arena 04 missing from " + base);
      results.push({ base, login: 200, anonymousArena: 401, adminArena: 200, arena04InCatalog: true });
      console.log("PASS " + base + ": authenticated Arena 04 catalogue verified.");
    } finally {
      await request("/api/auth/logout", { method: "POST", headers: { Cookie: cookie, Origin: base } });
    }
  }
  await writeFile(root + "/internal/qa/production-smoke.json", JSON.stringify({ version: pkg.version, checkedAt: new Date().toISOString(), results }, null, 2));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
