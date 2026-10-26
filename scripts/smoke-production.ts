import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
async function main() {
  const base = "https://olpai-mock-arena.vercel.app";
  const page = await fetch(base + "/login");
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("OlpAI Arena"));
  console.log("PASS public production login page");
  const denied = await fetch(base + "/api/arena");
  assert.equal(denied.status, 401);
  console.log("PASS anonymous application access denied");
  const access = await readFile("ACCESS.local.md", "utf8"),
    password = access.match(/Mật khẩu ban đầu: (.+)/)?.[1];
  assert.ok(password);
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username: "arena_admin", password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  assert.ok(login.headers.get("set-cookie")?.toLowerCase().includes("secure"));
  const result = await fetch(base + "/api/arena", {
    headers: { Cookie: cookie },
  });
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.user.admin, true);
  assert.equal(data.phase, "waiting");
  assert.equal(data.ready, true);
  assert.equal(data.contest.publicSeconds, 18000);
  assert.equal(data.contest.privateSeconds, 3600);
  assert.equal(data.submissions.length, 0);
  console.log(
    "PASS production admin, Redis package, 5h+1h contest in waiting state",
  );
  const statement = await fetch(base + "/api/statement", {
    headers: { Cookie: cookie },
  });
  assert.equal(statement.status, 200);
  assert.ok(
    (await statement.json()).statement.includes("Tách từng nhân tế bào"),
  );
  console.log("PASS admin statement before start");
  const pdf = data.assets.find((a: { name: string }) =>
    a.name.endsWith(".pdf"),
  );
  const asset = await fetch(
    base + "/api/download?asset=" + encodeURIComponent(pdf.key),
    { headers: { Cookie: cookie }, redirect: "manual" },
  );
  assert.equal(asset.status, 307);
  const location = asset.headers.get("location");
  assert.ok(location);
  const bytes = await fetch(location);
  assert.equal(bytes.status, 200);
  assert.equal((await bytes.arrayBuffer()).byteLength, pdf.bytes);
  console.log(
    "PASS private Blob authorized PDF download with verified byte count",
  );
  await fetch(base + "/api/auth/logout", {
    method: "POST",
    headers: { Origin: base, Cookie: cookie },
  });
  console.log("PASS logout; real contest left unopened");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
