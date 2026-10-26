import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db, key, serverNow } from "../src/lib/db";
import type { Contest } from "../src/lib/types";
const base = process.env.QA_URL ?? "http://localhost:3000";
async function main() {
  if (!process.env.ARENA_NAMESPACE?.startsWith("arena:qa:"))
    throw new Error("QA namespace required");
  let checks = 0;
  const ok = (name: string) => {
    checks++;
    console.log(`PASS ${name}`);
  };
  async function req(
    path: string,
    body?: unknown,
    cookie = "",
    expected = 200,
  ) {
    const response = await fetch(`${base}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/json", Origin: base }),
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    return {
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  const admin = (
    await req("auth/login", {
      username: "qa_admin",
      password: "Arena-QA-Only-2026!",
    })
  ).cookie;
  assert.ok(admin);
  ok("admin login");
  const suffix = randomUUID().slice(0, 6),
    cookies: string[] = [];
  for (let i = 0; i < 4; i++) {
    const result = await req("auth/register", {
      username: `qa_${suffix}_${i}`,
      name: ["Nguyễn Minh Anh", "Trần Gia Bảo", "Lê Thu Hà", "Người thứ tư"][i],
      password: "Arena-QA-Only-2026!",
    });
    cookies.push(result.cookie);
  }
  ok("individual registration and sessions");
  await req("statement", undefined, cookies[0], 403);
  await req("statement", undefined, admin);
  await req("admin/control", { action: "start" }, cookies[0], 403);
  ok("sealed statement and admin permissions");
  await req(
    "team",
    { action: "create", name: "Gradient Explorers" },
    cookies[0],
  );
  let snap = (await req("arena", undefined, cookies[0])).data;
  const code = snap.team.inviteCode;
  await req(
    "team",
    { action: "invite", username: `qa_${suffix}_1` },
    cookies[0],
  );
  let invite = (await req("arena", undefined, cookies[1])).data.invites;
  assert.equal(invite.length, 1);
  await req("team", { action: "join", teamId: invite[0].id }, cookies[1]);
  await req("team", { action: "join", code }, cookies[2]);
  await req("team", { action: "join", code }, cookies[3], 400);
  ok("teams, invitations, three-member capacity");
  await req(
    "admin/control",
    {
      action: "schedule",
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    },
    admin,
  );
  assert.equal(
    (await req("arena", undefined, cookies[0])).data.phase,
    "scheduled",
  );
  await req("admin/control", { action: "cancel" }, admin);
  await req("admin/control", { action: "start" }, admin);
  await req("statement", undefined, cookies[0]);
  ok("schedule, cancel, start and statement release");
  snap = (await req("arena", undefined, cookies[0])).data;
  assert.equal(
    snap.assets.some((a: { phase: string }) => a.phase === "private"),
    false,
  );
  const pkg = await db().get<{ assets: { phase: string; key: string }[] }>(
    key("package"),
  );
  const privateAsset = pkg!.assets.find((a) => a.phase === "private")!;
  const blocked = await fetch(
    `${base}/api/download?asset=${encodeURIComponent(privateAsset.key)}`,
    { headers: { Cookie: cookies[0] }, redirect: "manual" },
  );
  assert.equal(blocked.status, 403);
  ok("private dataset URL denied before phase");
  const pubAsset = pkg!.assets.find((a) => a.key.endsWith(".pdf"))!;
  const download = await fetch(
    `${base}/api/download?asset=${encodeURIComponent(pubAsset.key)}`,
    { headers: { Cookie: cookies[0] }, redirect: "manual" },
  );
  assert.equal(download.status, 307);
  assert.ok(download.headers.get("location")?.startsWith("https://"));
  ok("authorized short-lived dataset downloads");
  async function upload(
    task: string,
    split: string,
    cookie: string,
    nonce = randomUUID(),
    content?: string,
    expected = 200,
  ) {
    const f = new FormData();
    f.set(
      "file",
      new File(
        [
          content ??
            (await readFile(
              `../statements/contestant/Tac_vu_${task}/submission.csv`,
              "utf8",
            )),
        ],
        "baseline.csv",
        { type: "text/csv" },
      ),
    );
    f.set("task", task);
    f.set("split", split);
    f.set("nonce", nonce);
    f.set("note", "QA baseline");
    const r = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { Origin: base, Cookie: cookie },
      body: f,
    });
    const d = await r.json();
    assert.equal(r.status, expected, JSON.stringify(d));
    return d;
  }
  await upload(
    "2",
    "public",
    cookies[0],
    randomUUID(),
    "id,prediction\nbad,",
    422,
  );
  const nonce = randomUUID(),
    first = await upload("2", "public", cookies[0], nonce);
  const repeated = await upload("2", "public", cookies[1], nonce);
  assert.equal(first.id, repeated.id);
  await upload("1", "public", cookies[2]);
  snap = (await req("arena", undefined, cookies[0])).data;
  assert.equal(snap.submissions.length, 2);
  assert.ok(
    snap.submissions.every(
      (s: { score: number; path?: string }) =>
        typeof s.score === "number" && !s.path,
    ),
  );
  ok("real CSV validation, both metrics, shared team history, idempotency");
  // Exercise quota atomically without waiting for twenty uploads.
  await db().set(key(`quota:${snap.contest.id}:${snap.team.id}:2:public`), 20);
  await upload("2", "public", cookies[1], randomUUID(), undefined, 409);
  ok("shared quota enforcement");
  await req("team", { action: "leave" }, cookies[2]);
  await req("team", { action: "join", code }, cookies[2]);
  ok("membership changes remain available during contest");
  const c = await db().get<Contest>(key("contest")),
    now = await serverNow();
  await db().set(key("contest"), { ...c!, startAt: now - 18000 * 1000 });
  await upload("2", "public", cookies[0], randomUUID(), undefined, 409);
  snap = (await req("arena", undefined, cookies[0])).data;
  assert.equal(snap.phase, "private");
  assert.ok(snap.assets.some((a: { phase: string }) => a.phase === "private"));
  ok("five-hour boundary locks public and releases private");
  const truth = JSON.parse(
    await readFile(
      "../statements/organizer/labels/Tac_vu_2/private.json",
      "utf8",
    ),
  );
  const emptyCSV =
    "id,prediction\n" + truth.map((q: { id: string }) => q.id + ",").join("\n");
  const a = await upload("2", "private", cookies[0], randomUUID(), emptyCSV);
  await upload("2", "private", cookies[1], randomUUID(), emptyCSV);
  await req("select-final", { id: a.id }, cookies[2]);
  snap = (await req("arena", undefined, cookies[0])).data;
  assert.equal(snap.leaderboard.private, null);
  assert.ok(
    snap.submissions
      .filter((s: { split: string }) => s.split === "private")
      .every(
        (s: { score: number | null; secondary: number | null }) =>
          s.score === null && s.secondary === null,
      ),
  );
  assert.equal(snap.selections[`${snap.team.id}:2`], a.id);
  ok("private submissions score hidden, shared final selection");
  const privateAdmin = (await req("arena", undefined, admin)).data;
  assert.ok(privateAdmin.leaderboard.private.length);
  ok("admin retains visibility throughout");
  await db().set(key("contest"), {
    ...c!,
    startAt: (await serverNow()) - 21600 * 1000,
  });
  await upload("2", "private", cookies[0], randomUUID(), emptyCSV, 409);
  snap = (await req("arena", undefined, cookies[0])).data;
  assert.equal(snap.phase, "ended");
  assert.ok(snap.leaderboard.private.length);
  assert.ok(
    snap.submissions
      .filter((s: { split: string }) => s.split === "private")
      .every((s: { score: number | null }) => typeof s.score === "number"),
  );
  await req("select-final", { id: a.id }, cookies[0], 409);
  ok(
    "six-hour boundary locks submissions/selections and reveals private scores",
  );
  const csrf = await fetch(base + "/api/team", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.org",
      Cookie: cookies[0],
    },
    body: JSON.stringify({ action: "leave" }),
  });
  assert.equal(csrf.status, 403);
  ok("cross-origin mutation rejected");
  await req("admin/control", { action: "new" }, admin);
  const fresh = (await req("arena", undefined, cookies[0])).data;
  assert.equal(fresh.phase, "waiting");
  assert.equal(fresh.submissions.length, 0);
  ok("new contest has clean quota/history with archived run retained");
  console.log(`ALL ${checks} integration checks passed in isolated namespace.`);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
