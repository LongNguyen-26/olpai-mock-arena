/** Production inspection only: auth/read/logout; never submits, controls a round or calls a Pod. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { phaseOf, submissionAccess, chatbotAllowed, notebookAllowed } from "../src/lib/domain";
import type { Contest } from "../src/lib/types";

async function main() {
  const base = "https://olpai-mock-arena.vercel.app";
  assert.equal((await fetch(base + "/login")).status, 200);
  assert.equal((await fetch(base + "/api/arena")).status, 401);
  assert.equal((await fetch(base + "/api/workspace/state")).status, 401);
  const password = (await readFile("ACCESS.local.md", "utf8")).match(/Mật khẩu ban đầu: (.+)/)?.[1]?.trim();
  assert.ok(password, "Local admin access is unavailable");
  const login = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "arena_admin", password }),
  });
  assert.equal(login.status, 200, "Production admin login");
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  let keep = false;
  try {
    async function read(path: string) {
      const response = await fetch(base + path, { headers: { Cookie: cookie! } });
      assert.equal(response.status, 200, path.split("?")[0]);return response.json();
    }
    const catalog = await read("/api/arena");
    assert.equal(catalog.user.admin, true);
    assert.ok(Array.isArray(catalog.rounds));
    const proof = [];
    for (const round of catalog.rounds) {
      const snap = await read("/api/arena?round=" + encodeURIComponent(round.id));
      const c: Contest = snap.contest;
      assert.equal(c.roundId ?? c.id, round.id);
      assert.equal(snap.phase, phaseOf(c, snap.serverNow));
      assert.ok(Number.isInteger(c.revision ?? 0));
      assert.ok(Array.isArray(snap.submissions));
      assert.ok(Array.isArray(snap.leaderboard.public));
      for (const split of ["public", "private"] as const) {
        const gate = submissionAccess(c, snap.serverNow, split);
        if (gate.accepting) assert.ok(["public", "private", "practice"].includes(snap.phase));
      }
      proof.push({ id: round.id, phase: snap.phase, runId: c.id, revision: c.revision ?? 0,
        chatbotAllowed: chatbotAllowed(c, snap.serverNow), notebookAllowed: notebookAllowed(c, snap.serverNow), submissions: snap.submissions.length });
    }
    const workspace = await read("/api/workspace/state");
    assert.equal(workspace.encryptionReady, true);
    for (const w of workspace.workspaces) for (const secret of ["secret", "jupyterSecret", "ownerId"]) assert.equal(secret in w, false);
    if (process.argv.includes("--browser")) {
      await mkdir(".local", { recursive: true });
      const separator = cookie.indexOf("=");
      await writeFile(".local/round-access-production-auth.json", JSON.stringify({
        cookies: [{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), domain: "olpai-mock-arena.vercel.app", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [],
      }));
      keep = true;
    }
    console.log(JSON.stringify({ result: "PASS", roundCount: proof.length, phases: proof.map((p) => p.phase), workspaceCount: workspace.workspaces.length,
      checked: "production login, protected APIs, round snapshots, phase/access compatibility and secret-free Workspace response", roundOrPodMutations: 0 }));
  } finally {
    if (!keep) {
      const logout = await fetch(base + "/api/auth/logout", { method: "POST", headers: { Origin: base, Cookie: cookie } });
      assert.equal(logout.status, 200);
    }
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Production smoke failed");process.exitCode = 1; });
