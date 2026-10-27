/** Real HTTP/Redis QA in a private namespace. GPU provider is never called. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db, key } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import type { Contest } from "../src/lib/types";
import { defaultTemplate } from "../src/lib/workspace-domain";

const filename = ".local/qa-admin-refinements.json",
  base = "http://localhost:3007";
async function setup() {
  const namespace = `arena:qa:admin-ui:${randomUUID()}`;
  process.env.ARENA_NAMESPACE = namespace;
  const roundId = randomUUID(),
    runId = randomUUID(),
    password = "QA-Admin-Refinements-2026!";
  const pkg = JSON.parse(
    await readFile(
      "../statements/Arena_02/web_ready/handoff/package-config.json",
      "utf8",
    ),
  );
  const c: Contest = {
    id: runId,
    roundId,
    packageId: pkg.version,
    title: "Vòng luyện QA · Bộ đề 02",
    startAt: Date.now() - 10000,
    privateAt: null,
    forcedEndAt: null,
    publicSeconds: 18000,
    privateSeconds: 3600,
    publicLimit: 20,
    privateLimit: 5,
    autoApprove: true,
    taskCount: 3,
    createdAt: Date.now(),
  };
  const hash = await hashPassword(password),
    tx = db().multi();
  tx.set(key(`package:${pkg.version}`), { ...pkg, importedAt: Date.now() })
    .hset(key("packages"), { [pkg.version]: pkg.title })
    .set(key(`round:${roundId}`), c)
    .zadd(key("rounds"), { score: Date.now(), member: roundId })
    .set(key("admin"), "qa-admin");
  for (const [id, username] of [
    ["qa-admin", "qa_admin"],
    ["qa-user", "student@example.edu.vn"],
  ]) {
    tx.set(key(`user:${id}`), {
      id,
      username,
      name: id === "qa-admin" ? "Quản trị viên QA" : "Nguyễn Minh Anh",
      password: hash,
      teamId: id === "qa-user" ? "qa-team" : null,
      createdAt: Date.now(),
    }).set(key(`username:${username}`), id);
  }
  tx.hset(key("teams"), {
    "qa-team": {
      id: "qa-team",
      name: "BKDN · TEAM AI",
      captainId: "qa-user",
      members: ["qa-user"],
      inviteCode: "QAonly",
      createdAt: Date.now(),
    },
  })
    .hset(key(`registrations:${roundId}`), {
      "qa-user": {
        userId: "qa-user",
        status: "approved",
        registeredAt: Date.now(),
      },
      "qa-pending": {
        userId: "qa-pending",
        status: "pending",
        registeredAt: Date.now(),
      },
    })
    .set(key(`quota:${runId}:qa-team:3:private`), 3);
  const common = {
    runId,
    teamId: "qa-team",
    userId: "qa-user",
    split: "public",
    bytes: 400,
    sha256: "fixture",
    path: "",
    note: "",
    status: "accepted",
  };
  tx.hset(key(`submissions:${runId}`), {
    "qa-valid": {
      ...common,
      id: "qa-valid",
      task: "3",
      score: 29.74,
      secondary: 0,
      filename: "submission_public.csv",
      createdAt: Date.now() - 1000,
    },
    "qa-invalid": {
      ...common,
      id: "qa-invalid",
      task: "1",
      score: 0,
      secondary: 0,
      filename: "submission_invalid.csv",
      createdAt: Date.now(),
      status: "invalid",
      error: "Fixture reason that must not appear in table",
    },
    "qa-task1": {
      ...common,
      id: "qa-task1",
      task: "1",
      score: 24.56,
      secondary: 0,
      filename: "submission_1.csv",
      createdAt: Date.now() - 3000,
    },
    "qa-task2": {
      ...common,
      id: "qa-task2",
      task: "2",
      score: 31.25,
      secondary: 0,
      filename: "submission_2.csv",
      createdAt: Date.now() - 2000,
    },
  });
  await tx.exec();
  await writeFile(
    filename,
    JSON.stringify({
      namespace,
      roundId,
      runId,
      password,
      packageId: pkg.version,
    }),
  );
  console.log("Created isolated admin UI fixture; production data unchanged.");
}
async function run() {
  const state = JSON.parse(await readFile(filename, "utf8"));
  process.env.ARENA_NAMESPACE = state.namespace;
  assert.ok(state.namespace.startsWith("arena:qa:admin-ui:"));
  const cookies: string[] = [];
  async function request(
    route: string,
    cookie: string,
    value?: unknown,
    status = 200,
  ) {
    const res = await fetch(`${base}/api/${route}?round=${state.roundId}`, {
      method: value === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        ...(value === undefined
          ? {}
          : { Origin: base, "Content-Type": "application/json" }),
      },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    const data = await res.json();
    assert.equal(res.status, status, JSON.stringify(data));
    return { data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  try {
    const admin = (
      await request("auth/login", "", {
        username: "qa_admin",
        password: state.password,
      })
    ).cookie;
    cookies.push(admin);
    const user = (
      await request("auth/login", "", {
        username: "Student@Example.edu.vn",
        password: state.password,
      })
    ).cookie;
    cookies.push(user);
    const template = {
      ...defaultTemplate,
      id: randomUUID(),
      services: "llm",
      imageName: "example/qa-workspace:fixture",
    };
    await request("workspace/template", admin, template);
    await request(
      "workspace/deploy",
      admin,
      {
        teamId: null,
        roundId: state.roundId,
        templateId: template.id,
        scope: "all",
        services: "jupyter",
        maxHourlyUsd: 1,
      },
      409,
    );
    const grant = {
      action: "grant-quota",
      runId: state.runId,
      requestId: randomUUID(),
      split: "private",
      amount: 7,
    };
    await request("admin/control", user, grant, 403);
    await request("admin/control", admin, { ...grant, amount: 0 }, 400);
    const duplicates = await Promise.all(
      Array.from({ length: 5 }, () => request("admin/control", admin, grant)),
    );
    assert.equal(duplicates.length, 5);
    let c = await db().get<Contest>(key(`round:${state.roundId}`));
    assert.equal(c!.privateLimit, 12);
    assert.equal(
      c!.forcedEndAt,
      null,
      "Quota grant changed the end-time field",
    );
    assert.equal(
      c!.privateAt,
      null,
      "Quota grant changed the private-time field",
    );
    assert.equal(
      await db().get(key(`quota:${state.runId}:qa-team:3:private`)),
      3,
      "Used quota was reset",
    );
    await request("admin/control", admin, { ...grant, amount: 8 }, 409);
    await Promise.all([
      request("admin/control", admin, {
        ...grant,
        requestId: randomUUID(),
        amount: 2,
      }),
      request("admin/control", admin, {
        ...grant,
        requestId: randomUUID(),
        amount: 3,
      }),
    ]);
    c = await db().get<Contest>(key(`round:${state.roundId}`));
    assert.equal(c!.privateLimit, 17);
    await request("admin/control", admin, { action: "open-private" });
    await request("admin/control", admin, {
      ...grant,
      requestId: randomUUID(),
      amount: 4,
    });
    c = await db().get<Contest>(key(`round:${state.roundId}`));
    assert.equal(c!.privateLimit, 21);
    await request(
      "admin/control",
      admin,
      { ...grant, requestId: randomUUID(), runId: randomUUID() },
      409,
    );
    await request("admin/control", admin, { action: "finish" });
    await request(
      "admin/control",
      admin,
      { ...grant, requestId: randomUUID() },
      409,
    );
    const fresh = { ...c!, privateAt: null, forcedEndAt: null };
    await db().set(key(`round:${state.roundId}`), fresh);
    const email = `qa-long-student-${randomUUID().slice(0, 8)}@example.edu.vn`;
    await request(
      "auth/register",
      "",
      { username: "not_an_email", name: "Student", password: state.password },
      400,
    );
    const registered = (
      await request("auth/register", "", {
        username: email.toUpperCase(),
        name: "Student Email",
        password: state.password,
      })
    ).cookie;
    cookies.push(registered);
    const account = (await request("arena", registered)).data;
    assert.equal(account.user.username, email);
    const logged = (
      await request("auth/login", "", {
        username: email,
        password: state.password,
      })
    ).cookie;
    cookies.push(logged);
    assert.equal((await request("arena", logged)).data.user.username, email);
    console.log(
      "PASS HTTP: new email registration/login, legacy admin login, admin-only quota, five concurrent duplicates counted once, concurrent independent grants retained, used quota preserved, private grant and stale/closed rejection.",
    );
  } finally {
    for (const cookie of cookies) await request("auth/logout", cookie, {});
  }
}
async function cleanup() {
  const state = JSON.parse(await readFile(filename, "utf8"));
  assert.ok(state.namespace.startsWith("arena:qa:admin-ui:"));
  process.env.ARENA_NAMESPACE = state.namespace;
  let cursor = "0";
  do {
    const [next, keys] = await db().scan(cursor, {
      match: `${state.namespace}:*`,
      count: 1000,
    });
    if (keys.length) await db().del(...keys);
    cursor = String(next);
  } while (cursor !== "0");
  console.log("Removed this run's isolated Redis QA fixture.");
}
(process.argv[2] === "setup"
  ? setup()
  : process.argv[2] === "cleanup"
    ? cleanup()
    : run()
).catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
