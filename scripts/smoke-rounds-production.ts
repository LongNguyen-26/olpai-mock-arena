import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
async function main() {
  const base = "https://olpai-mock-arena.vercel.app";
  const page = await fetch(base + "/login");
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("<title>OlpAI Arena</title>"));
  assert.equal((await fetch(base + "/icon.svg")).status, 200);
  assert.equal((await fetch(base + "/api/arena")).status, 401);
  const access = await readFile("ACCESS.local.md", "utf8"),
    password = access.match(/Mật khẩu ban đầu: (.+)/)?.[1];
  assert.ok(password);
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "arena_admin", password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const catalog = await (
    await fetch(base + "/api/arena", { headers: { Cookie: cookie } })
  ).json();
  assert.equal(catalog.user.admin, true);
  assert.equal(catalog.contest, null);
  assert.ok(catalog.rounds.length >= 1);
  for (const round of catalog.rounds) {
    const snap = await (
      await fetch(base + "/api/arena?round=" + round.id, {
        headers: { Cookie: cookie },
      })
    ).json();
    assert.equal(snap.phase, "waiting");
    assert.equal(snap.contest.startAt, null);
    assert.equal(snap.submissions.length, 0);
    assert.equal(snap.ready, true);
    assert.ok(
      snap.assets
        .filter((a: { name: string }) => a.name.endsWith(".zip"))
        .every((a: { driveUrl?: string }) =>
          a.driveUrl?.startsWith("https://drive.google.com/"),
        ),
    );
    const statement = await (
      await fetch(base + "/api/statement?round=" + round.id, {
        headers: { Cookie: cookie },
      })
    ).json();
    assert.equal(statement.tasks.length, 2);
    console.log(
      "PASS production round, task pages, Drive links, reset timer: " +
        round.title,
    );
  }
  await fetch(base + "/api/auth/logout", {
    method: "POST",
    headers: { Origin: base, Cookie: cookie },
  });
  console.log(
    "PASS public login/favicon, protected API, production admin and logout",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
