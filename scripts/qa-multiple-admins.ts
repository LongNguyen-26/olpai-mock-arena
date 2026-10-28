/** Isolated HTTP/Redis authorization QA; does not call a GPU provider. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { db, key } from "../src/lib/db";
import { SUBMIT_SCRIPT } from "../src/lib/arena";
import type { Submission, User } from "../src/lib/types";

async function main() {
  const fixture = JSON.parse(
    await readFile(".local/qa-admin-refinements.json", "utf8"),
  );
  assert.ok(fixture.namespace.startsWith("arena:qa:"));
  process.env.ARENA_NAMESPACE = fixture.namespace;
  const base = "http://localhost:3007",
    cookies: string[] = [];
  const request = async (
    route: string,
    cookie: string,
    body?: unknown,
    round = "",
    expected = 200,
  ) => {
    const res = await fetch(
      base + "/api/" + route + (round ? "?round=" + round : ""),
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: cookie,
          Origin: base,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    const data = await res.json();
    assert.equal(res.status, expected, JSON.stringify(data));
    return { data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  const primary = await db().get<string>(key("admin"));
  assert.equal(primary, "qa-admin");
  const username = "qa_admin_2_" + randomUUID().slice(0, 8);
  const credentialsFile = `.local/${username}.local.md`;
  const args = [
    "--import",
    "tsx",
    "--env-file=.env",
    "scripts/create-admin.ts",
    username,
    "Quản trị viên QA 2",
    credentialsFile,
  ];
  execFileSync(process.execPath, args, {
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
  });
  const password = (await readFile(credentialsFile, "utf8")).match(
    /Mật khẩu: (.+)/,
  )?.[1];
  assert.ok(password);
  const id = await db().get<string>(key("username:" + username));
  assert.ok(id);
  const created = await db().get<User>(key("user:" + id));
  assert.ok(created);
  assert.throws(() =>
    execFileSync(process.execPath, args, { env: process.env, stdio: "pipe" }),
  );
  assert.ok(
    (await db().get<User>(key("user:" + id)))?.password === created.password,
    "Retry must not replace the existing password",
  );
  try {
    const first = (
      await request("auth/login", "", {
        username: "qa_admin",
        password: fixture.password,
      })
    ).cookie;
    const second = (
      await request("auth/login", "", {
        username,
        password,
      })
    ).cookie;
    const user = (
      await request("auth/login", "", {
        username: "student@example.edu.vn",
        password: fixture.password,
      })
    ).cookie;
    cookies.push(first, second, user);
    assert.equal((await request("me", first)).data.user.admin, true);
    assert.equal((await request("me", second)).data.user.admin, true);
    assert.equal((await request("me", user)).data.user.admin, false);
    const round = fixture.roundId,
      before = (await request("arena", first, undefined, round)).data;
    await request(
      "admin/control",
      second,
      { action: "visibility", hidden: true },
      round,
    );
    assert.equal(
      (await request("arena", first, undefined, round)).data.contest.hidden,
      true,
    );
    await request(
      "admin/control",
      first,
      { action: "visibility", hidden: false },
      round,
    );
    await request(
      "admin/control",
      user,
      { action: "visibility", hidden: true },
      round,
      403,
    );
    const c = (await request("arena", second, undefined, round)).data.contest;
    const submit = async (userId: string) => {
      const submission: Submission = {
        id: randomUUID(),
        runId: c.id,
        userId,
        teamId: "admin-" + userId,
        task: "1",
        split: "public",
        filename: "qa.csv",
        createdAt: Date.now(),
        score: 1,
        secondary: 0,
        bytes: 1,
        sha256: "qa",
        path: "",
        note: "",
        status: "accepted",
        adminTest: true,
      };
      const quota = key("qa-admin-quota:" + submission.id);
      const result = await db().eval(
        SUBMIT_SCRIPT,
        [
          key("round:" + round),
          quota,
          key("submissions:" + c.id),
          key("qa-admin-request:" + submission.id),
          key("user:" + userId),
          key("registrations:" + round),
          key("admin"),
          key("admins"),
        ],
        [c.id, "public", JSON.stringify(submission), submission.teamId],
      );
      assert.equal(await db().exists(quota), 0);
      return { result, id: submission.id };
    };
    const adminTrial = await submit(id);
    assert.equal(adminTrial.result, adminTrial.id);
    assert.equal((await submit("qa-user")).result, "role");
    await db().hset(key("registrations:" + round), {
      [id]: { userId: id, status: "approved", registeredAt: Date.now() },
    });
    const after = (await request("arena", second, undefined, round)).data;
    assert.equal(after.participantCount, before.participantCount);
    assert.equal(
      after.rounds[0].registrationCount,
      before.rounds[0].registrationCount,
    );
    await db().srem(key("admins"), id);
    assert.equal((await request("me", second)).data.user.admin, false);
    await request(
      "admin/control",
      second,
      { action: "visibility", hidden: true },
      round,
      403,
    );
    assert.equal((await request("me", first)).data.user.admin, true);
    assert.equal(await db().get(key("admin")), primary);
    console.log(
      "PASS HTTP/Redis: legacy and additional admin login, both control rounds, ordinary users denied, secondary admin trials accepted without quota/ranking, admins excluded from participants, role revocation immediate; original admin unchanged.",
    );
  } finally {
    for (const cookie of cookies) await request("auth/logout", cookie, {});
    await unlink(credentialsFile);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
