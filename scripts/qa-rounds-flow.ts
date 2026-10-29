import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db, key } from "../src/lib/db";
import type { Contest } from "../src/lib/types";
import { contestEnd } from "../src/lib/domain";
const base = "http://localhost:3000";
async function main() {
  if (!process.env.ARENA_NAMESPACE?.startsWith("arena:qa:"))
    throw new Error("QA namespace required");
  let checks = 0;
  const pass = (s: string) => {
    checks++;
    console.log("PASS " + s);
  };
  async function request(
    route: string,
    cookie: string,
    value?: unknown,
    round = "",
    expected = 200,
  ) {
    if ((value as { action?: string } | undefined)?.action === "open-private") {
      const current = (await request("arena", cookie, undefined, round)).data
        .contest;
      value = {
        action: "open-private",
        runId: current.id,
        revision: current.revision ?? 0,
        requestId: randomUUID(),
        lockPublic: true,
        revokeChatbot: true,
        endAt: contestEnd(current),
      };
    }
    const res = await fetch(
      base + "/api/" + route + (round ? "?round=" + round : ""),
      {
        method: value === undefined ? "GET" : "POST",
        headers: {
          Cookie: cookie,
          ...(value === undefined
            ? {}
            : { Origin: base, "Content-Type": "application/json" }),
        },
        body: value === undefined ? undefined : JSON.stringify(value),
      },
    );
    const data = await res.json();
    assert.equal(res.status, expected, JSON.stringify(data));
    return { data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  const admin = (
    await request("auth/login", "", {
      username: "qa_admin",
      password: "Arena-QA-Only-2026!",
    })
  ).cookie;
  let catalog = (await request("arena", admin)).data;
  const first = catalog.rounds[0].id,
    pkg = catalog.packages[0].id;
  const users: string[] = [];
  for (let i = 0; i < 2; i++)
    users.push(
      (
        await request("auth/register", "", {
          username: "round_" + randomUUID().slice(0, 8) + "@example.test",
          name: "Thí sinh " + i,
          password: "Arena-QA-Only-2026!",
        })
      ).cookie,
    );
  pass("login and individual registration");
  const initial = (await request("arena", users[0])).data;
  assert.equal(initial.contest, null);
  assert.equal(initial.rounds.length, 1);
  assert.equal(initial.tasks.length, 0);
  assert.equal(initial.assets.length, 0);
  await request("statement", users[0], undefined, first, 403);
  pass(
    "catalogue visible with no statement/data before entry and registration",
  );
  await request("round/register", users[0], {}, first);
  await request("round/register", users[1], {}, first);
  const enrolled = (await request("arena", users[0], undefined, first)).data;
  assert.equal(enrolled.registration.status, "approved");
  assert.equal(enrolled.canReadStatement, false);
  assert.equal(enrolled.tasks.length, 0);
  pass("auto approval and locked materials before start");
  await request("team", users[0], {
    action: "create",
    name: "Đội QA vòng luyện",
  });
  let snap = (await request("arena", users[0], undefined, first)).data;
  await request("team", users[1], {
    action: "join",
    code: snap.team.inviteCode,
  });
  await request("admin/control", admin, { action: "start" }, first);
  snap = (await request("arena", users[0], undefined, first)).data;
  assert.equal(snap.tasks.length, 2);
  assert.ok(
    snap.assets.every(
      (a: { name: string; phase: string }) =>
        !a.name.endsWith(".md") && a.phase === "public",
    ),
  );
  const statement = (await request("statement", users[0], undefined, first))
    .data;
  assert.equal(statement.tasks.length, 2);
  assert.ok(
    !JSON.stringify(statement).includes("Nguồn tham khảo và phạm vi suy luận"),
  );
  assert.ok(!JSON.stringify(statement).includes("không phải đề hoặc quy chế"));
  pass("start releases two cleaned task statements and ZIP resources");
  async function upload(
    task: string,
    split: string,
    file: string,
    cookie = users[0],
    round = first,
    nonce = randomUUID(),
    expected = 200,
  ) {
    const f = new FormData();
    f.set("file", new File([await readFile(file)], "test.csv"));
    f.set("task", task);
    f.set("split", split);
    f.set("nonce", nonce);
    f.set("note", "QA");
    const res = await fetch(base + "/api/submit?round=" + round, {
      method: "POST",
      headers: { Origin: base, Cookie: cookie },
      body: f,
    });
    const result = await res.json();
    assert.equal(res.status, expected, JSON.stringify(result));
    return result;
  }
  const path = (split: string, task: string, name: string) =>
    `.local/test-submissions/${split}/Tac_vu_${task}/${name}.csv`;
  await upload(
    "1",
    "public",
    path("public", "1", "01-khong-hop-le"),
    users[0],
    first,
    randomUUID(),
    422,
  );
  const invalidSnap = (await request("arena", users[0], undefined, first)).data;
  assert.equal(invalidSnap.submissions.length, 1);
  assert.equal(invalidSnap.submissions[0].status, "invalid");
  assert.equal(
    await db().get(
      key(
        `quota:${invalidSnap.contest.id}:${invalidSnap.user.teamId}:1:public`,
      ),
    ),
    null,
  );
  const adminTrial = await upload(
    "1",
    "public",
    path("public", "1", "00-nop-thu"),
    admin,
  );
  assert.equal(adminTrial.adminTest, true);
  assert.equal(
    (await request("arena", admin, undefined, first)).data.leaderboard.public
      .length,
    0,
  );
  await request(
    "team",
    admin,
    { action: "create", name: "Admin team" },
    "",
    403,
  );
  pass(
    "invalid attempts retained without quota; admin trials excluded from ranking and teams",
  );
  const n = randomUUID();
  const [a, b] = await Promise.all([
    upload(
      "1",
      "public",
      path("public", "1", "00-nop-thu"),
      users[0],
      first,
      n,
    ),
    upload(
      "1",
      "public",
      path("public", "1", "00-nop-thu"),
      users[1],
      first,
      n,
    ),
  ]);
  assert.equal(a.id, b.id);
  await upload("2", "public", path("public", "2", "03-hop-le-diem-cao"));
  snap = (await request("arena", users[0], undefined, first)).data;
  assert.equal(snap.submissions.length, 3);
  assert.equal(
    snap.submissions.filter((s: { status: string }) => s.status === "invalid")
      .length,
    1,
  );
  assert.equal(
    await db().get(
      key(`quota:${snap.contest.id}:${snap.user.teamId}:1:public`),
    ),
    1,
  );
  assert.equal(snap.participantCount, 2);
  assert.equal(snap.teamCount, 1);
  assert.ok(snap.leaderboard.public[0].total > 140);
  pass("real scoring, sum of task scores and concurrent shared idempotency");
  const privateKey = (await db().get<{
    assets: { key: string; phase: string }[];
  }>(key("package:" + pkg)))!.assets.find((a) => a.phase === "private")!.key;
  const privateDenied = await fetch(
    base +
      "/api/download?round=" +
      first +
      "&source=drive&asset=" +
      encodeURIComponent(privateKey),
    { headers: { Cookie: users[0] }, redirect: "manual" },
  );
  assert.equal(privateDenied.status, 403);
  pass("private Drive link denied before private is opened");
  await request("admin/control", admin, { action: "open-private" }, first);
  const low = await upload(
    "2",
    "private",
    path("private", "2", "02-hop-le-diem-thap"),
  );
  await upload(
    "2",
    "private",
    path("private", "2", "03-hop-le-diem-cao"),
    users[1],
  );
  await upload("1", "private", path("private", "1", "03-hop-le-diem-cao"));
  snap = (await request("arena", users[0], undefined, first)).data;
  assert.equal(snap.phase, "private");
  assert.equal(snap.leaderboard.private[0].total, 200);
  assert.ok(
    snap.submissions.every((s: { score: unknown; status: string }) =>
      s.status === "invalid" ? s.score === null : typeof s.score === "number",
    ),
  );
  await upload(
    "2",
    "public",
    path("public", "2", "00-nop-thu"),
    users[0],
    first,
    randomUUID(),
    409,
  );
  pass(
    "early private opens live private scores/leaderboard and uses best result",
  );
  const another = (
    await request("admin/round/create", admin, {
      title: "Vòng luyện chờ duyệt",
      packageId: pkg,
    })
  ).data.id;
  await request(
    "admin/control",
    admin,
    {
      action: "configure",
      title: "Vòng luyện chờ duyệt",
      publicSeconds: 30,
      privateSeconds: 30,
      publicLimit: 20,
      privateLimit: 5,
      unlimited: true,
      autoApprove: false,
    },
    another,
  );
  await request("round/register", users[0], {}, another);
  const pending = (await request("arena", users[0], undefined, another)).data;
  assert.equal(pending.registration.status, "pending");
  assert.equal(pending.entered, false);
  assert.equal(pending.assets.length, 0);
  const userId = pending.user.id;
  await request("admin/control", admin, { action: "start" }, another);
  await request("statement", users[0], undefined, another, 403);
  await request(
    "admin/registration",
    admin,
    { userId, status: "approved" },
    another,
  );
  await request("statement", users[0], undefined, another);
  pass(
    "admin confirmation publishes new round; manual approval gates material access",
  );
  const config = await db().get<Contest>(key("round:" + another));
  await db().set(key("round:" + another), {
    ...config!,
    startAt: Date.now() - 99999999,
  });
  assert.equal(
    (await request("arena", users[0], undefined, another)).data.phase,
    "public",
  );
  await request("admin/control", admin, { action: "open-private" }, another);
  assert.equal(
    (await request("arena", users[0], undefined, another)).data.phase,
    "private",
  );
  pass("unlimited public/private rounds stay open until admin closes");
  await request(
    "admin/registration",
    admin,
    { userId, status: "rejected" },
    another,
  );
  await request("statement", users[0], undefined, another, 403);
  await request(
    "admin/registration",
    admin,
    { userId, status: "approved" },
    another,
  );
  pass("revoking approval immediately revokes access");
  const firstBefore = (await request("arena", admin, undefined, first)).data;
  await request("admin/control", admin, { action: "reset" }, another);
  const reset = (await request("arena", users[0], undefined, another)).data;
  assert.equal(reset.phase, "waiting");
  assert.equal(reset.submissions.length, 0);
  assert.equal(reset.registration.status, "approved");
  const isolated = (await request("arena", users[0], undefined, first)).data;
  assert.equal(isolated.leaderboard.private[0].total, 200);
  assert.equal(isolated.contest.id, firstBefore.contest.id);
  pass("reset preserves enrollment and isolates scores/quota across rounds");
  const adminInfo = (await request("arena", admin, undefined, first)).data;
  await writeFile(
    ".local/qa-session.json",
    JSON.stringify({
      adminCookie: admin,
      userCookie: users[0],
      first,
      another,
    }),
  );
  console.log(`ALL ${checks} multi-round integration checks passed.`);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
