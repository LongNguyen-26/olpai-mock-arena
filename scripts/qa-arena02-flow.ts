/** Isolated real HTTP/Redis/Blob checks. Never touches production round keys or provisions GPU. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { db, key, storage } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { packageSchema } from "../src/lib/package-schema";

const root = resolve("../statements/Arena_02/web_ready"),
  statePath = ".local/qa-arena02.json";
const base = "http://localhost:3005";
const ROUND_ID = "00000000-0000-4000-8000-000000000002";
async function setup() {
  const namespace = `arena:qa:arena02:${randomUUID()}`;
  process.env.ARENA_NAMESPACE = namespace;
  const pkg = packageSchema.parse(
    JSON.parse(
      await readFile(join(root, "handoff/package-config.json"), "utf8"),
    ),
  );
  const password = "Arena-QA-Fixture-2026!",
    hash = await hashPassword(password);
  const round = {
    id: "qa-run",
    roundId: ROUND_ID,
    packageId: pkg.version,
    title: "QA Bộ đề 02",
    taskCount: 3,
    startAt: Date.now() - 1000,
    forcedEndAt: null,
    publicSeconds: 18000,
    privateSeconds: 3600,
    publicLimit: 20,
    privateLimit: 5,
    createdAt: Date.now(),
  };
  const tx = db()
    .multi()
    .set(key(`package:${pkg.version}`), { ...pkg, importedAt: Date.now() })
    .set(key(`round:${ROUND_ID}`), round)
    .zadd(key("rounds"), { score: Date.now(), member: ROUND_ID })
    .set(key("admin"), "qa-admin");
  for (const [id, username] of [
    ["qa-admin", "arena02_admin"],
    ["qa-user", "arena02_user"],
    ["qa-other", "arena02_other"],
  ]) {
    tx.set(key(`user:${id}`), {
      id,
      username,
      name: username,
      password: hash,
      teamId: id === "qa-user" ? "qa-team" : null,
      createdAt: Date.now(),
    }).set(key(`username:${username}`), id);
  }
  tx.hset(key("teams"), {
    "qa-team": {
      id: "qa-team",
      name: "Đội QA 02",
      captainId: "qa-user",
      members: ["qa-user"],
      inviteCode: "fixture",
      createdAt: Date.now(),
    },
  }).hset(key(`registrations:${ROUND_ID}`), {
    "qa-user": {
      userId: "qa-user",
      status: "approved",
      registeredAt: Date.now(),
    },
  });
  await tx.exec();
  await writeFile(
    statePath,
    JSON.stringify({
      namespace,
      roundId: ROUND_ID,
      password,
      pkgVersion: pkg.version,
    }),
  );
  console.log(
    "Created isolated QA namespace and fixture; no production keys changed.",
  );
}
async function run() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.ok(state.namespace.startsWith("arena:qa:arena02:"));
  process.env.ARENA_NAMESPACE = state.namespace;
  const cookies: string[] = [];
  async function request(
    route: string,
    cookie = "",
    value?: unknown,
    round = ROUND_ID,
    status = 200,
  ) {
    const res = await fetch(
      `${base}/api/${route}${round ? "?round=" + round : ""}`,
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
    assert.equal(res.status, status, JSON.stringify(data));
    return { data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  try {
    for (const username of ["arena02_admin", "arena02_user", "arena02_other"]) {
      cookies.push(
        (
          await request(
            "auth/login",
            "",
            { username, password: state.password },
            "",
            200,
          )
        ).cookie,
      );
      assert.ok(cookies.at(-1));
    }
    const [admin, user, other] = cookies;
    await request("statement", other, undefined, ROUND_ID, 403);
    const snap = (await request("arena", user)).data;
    assert.deepEqual(snap.taskIds, ["1", "2", "3"]);
    assert.equal(snap.maxScore, 100);
    assert.equal(snap.tasks.length, 3);
    assert.equal(snap.assets.length, 6);
    assert.ok(
      snap.assets.every((a: { phase: string }) => a.phase === "public"),
    );
    const statements = (await request("statement", user)).data;
    assert.equal(statements.tasks.length, 3);
    assert.ok(!JSON.stringify(statements).includes("Dành cho ban tổ chức"));
    const pkg = packageSchema.parse(
      JSON.parse(
        await readFile(join(root, "handoff/package-config.json"), "utf8"),
      ),
    );
    const hidden = pkg.assets.find((a) => a.phase === "private")!;
    const locked = await fetch(
      `${base}/api/download?round=${ROUND_ID}&asset=${encodeURIComponent(hidden.key)}`,
      { headers: { Cookie: user }, redirect: "manual" },
    );
    assert.equal(locked.status, 403);
    const pdf = pkg.assets.find((a) => a.name === "De_bai_3.pdf")!;
    const downloaded = await fetch(
      `${base}/api/download?round=${ROUND_ID}&asset=${encodeURIComponent(pdf.key)}`,
      { headers: { Cookie: user }, redirect: "manual" },
    );
    assert.equal(downloaded.status, 307);
    const content = await fetch(downloaded.headers.get("location")!);
    assert.equal(content.status, 200);
    assert.equal((await content.arrayBuffer()).byteLength, pdf.bytes);
    async function submit(
      task: string,
      split: string,
      text: string,
      nonce = randomUUID(),
      who = user,
      status = 200,
    ) {
      const form = new FormData();
      form.set("task", task);
      form.set("split", split);
      form.set("nonce", nonce);
      form.set(
        "file",
        new File([text], "submission.csv", { type: "text/csv" }),
      );
      const response = await fetch(`${base}/api/submit?round=${ROUND_ID}`, {
        method: "POST",
        headers: { Origin: base, Cookie: who },
        body: form,
      });
      const data = await response.json();
      assert.equal(response.status, status, JSON.stringify(data));
      return data;
    }
    const fixtures = JSON.parse(
      await readFile(join(root, "qa/judge_fixtures.json"), "utf8"),
    );
    for (const task of ["1", "2", "3"]) {
      const f = fixtures.find(
        (f: { task: string; split: string }) =>
          f.task === task && f.split === "public",
      );
      const text = await readFile(join(root, f.csv), "utf8"),
        nonce = randomUUID();
      const first = await submit(task, "public", text, nonce);
      assert.equal(first.score, f.score);
      assert.ok(Math.abs(first.metric - f.metric) < 1e-12);
      if (task === "1")
        assert.equal((await submit(task, "public", text, nonce)).id, first.id);
    }
    await submit(
      "3",
      "public",
      "id,label\nmissing,binh_thuong",
      randomUUID(),
      user,
      422,
    );
    const board = (await request("arena", user)).data;
    assert.equal(board.leaderboard.public[0].total, 0);
    assert.equal(board.leaderboard.public[0].submitted, 3);
    assert.equal(board.leaderboard.public[0].scores["3"], 0);
    // Persist the public fixture snapshot for desktop/mobile UI checks before opening private.
    await writeFile(
      ".local/qa-arena02-public-snapshot.json",
      JSON.stringify(board),
    );
    await request("admin/control", admin, { action: "open-private" });
    const privateSnap = (await request("arena", user)).data;
    assert.equal(privateSnap.assets.length, 9);
    assert.ok(Array.isArray(privateSnap.leaderboard.private));
    const pf = fixtures.find(
      (f: { task: string; split: string }) =>
        f.task === "3" && f.split === "private",
    );
    await submit("3", "private", await readFile(join(root, pf.csv), "utf8"));
    await submit(
      "1",
      "public",
      await readFile(join(root, fixtures[0].csv), "utf8"),
      randomUUID(),
      user,
      409,
    );
    // Restore only this QA fixture to public for browser inspection.
    const c = await db().get<Record<string, unknown>>(key(`round:${ROUND_ID}`));
    await db().set(key(`round:${ROUND_ID}`), { ...c, privateAt: null });
    console.log(
      "PASS HTTP: login, registration guard, three statements, private asset gate, real PDF download, all three metrics, duplicate nonce, invalid quota, third-task leaderboard and private transition.",
    );
  } finally {
    for (const cookie of cookies)
      await request("auth/logout", cookie, {}, "", 200);
  }
}
async function cleanup() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.ok(state.namespace.startsWith("arena:qa:arena02:"));
  process.env.ARENA_NAMESPACE = state.namespace;
  const bucket = storage();
  await bucket.del({ prefix: `submissions/${state.namespace}/` });
  for (;;) {
    const keys = await db().scan("0", {
      match: `${state.namespace}:*`,
      count: 1000,
    });
    const names = keys[1] as string[];
    if (names.length) await db().del(...names);
    if (String(keys[0]) === "0") break;
  }
  console.log(
    "Removed only this run's isolated QA Redis and submission objects.",
  );
}
const mode = process.argv[2];
(mode === "setup" ? setup() : mode === "cleanup" ? cleanup() : run()).catch(
  (e) => {
    console.error(e.message);
    process.exitCode = 1;
  },
);
