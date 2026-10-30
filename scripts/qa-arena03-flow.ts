import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, key, storage } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import type { Contest, ContestPackage, Team, User } from "../src/lib/types";
const file = ".local/arena03-qa.json";
const root = resolve("../statements/Arena_03");
const base = "http://localhost:3019";

async function main() {
  if (process.argv[2] === "setup") {
    const namespace = "arena:qa:arena03:" + randomUUID();
    process.env.ARENA_NAMESPACE = namespace;
    const pkg = JSON.parse(await readFile(root + "/web_ready/release_20261030/handoff/package-config.json", "utf8")) as ContestPackage;
    const adminId = randomUUID(), userId = randomUUID(), teamId = randomUUID(), roundId = randomUUID();
    const password = "Arena03-QA-Only-2026!";
    const now = Date.now();
    const admin: User = { id: adminId, username: "qa_arena03_admin", name: "Quản trị QA Arena 03", password: await hashPassword(password), teamId: null, createdAt: now };
    const user: User = { id: userId, username: "qa_arena03_user", name: "Thí sinh QA Arena 03", password: await hashPassword(password), teamId, createdAt: now };
    const team: Team = { id: teamId, name: "Đội QA Arena 03", captainId: userId, members: [userId], inviteCode: randomUUID(), createdAt: now };
    const round: Contest = { id: roundId, roundId, packageId: pkg.version, taskCount: 2, title: "Arena 03 QA cô lập", startAt: null, privateAt: null, forcedEndAt: null, publicSeconds: 18000, privateSeconds: 3600, publicLimit: 20, privateLimit: 5, createdAt: now };
    await db().multi().set(key(`package:${pkg.version}`), pkg).hset(key("packages"), { [pkg.version]: pkg.title! })
      .set(key("admin"), adminId).set(key(`user:${adminId}`), admin).set(key(`user:${userId}`), user)
      .set(key(`username:${admin.username}`), adminId).set(key(`username:${user.username}`), userId)
      .hset(key("teams"), { [teamId]: team }).set(key(`round:${roundId}`), round)
      .zadd(key("rounds"), { score: now, member: roundId })
      .hset(key(`registrations:${roundId}`), { [userId]: { userId, status: "approved", registeredAt: now } }).exec();
    await writeFile(file, JSON.stringify({ namespace, roundId, adminId, userId, password, version: pkg.version }, null, 2));
    console.log("Isolated Arena 03 QA fixture ready; no production round changed.");
    return;
  }
  const state = JSON.parse(await readFile(file, "utf8"));
  assert.ok(state.namespace.startsWith("arena:qa:arena03:"));
  process.env.ARENA_NAMESPACE = state.namespace;
  if (process.argv[2] === "cleanup") {
    let cursor = "0";
    do {
      const result = await db().scan(cursor, { match: `${state.namespace}:*`, count: 100 });
      cursor = String(result[0]);
      const keys = result[1];
      if (keys.length) await db().del(...keys);
    } while (cursor !== "0");
    await storage().del({ prefix: `submissions/${state.namespace}/` });
    await writeFile(file, JSON.stringify({ namespace: state.namespace, cleaned: true }, null, 2));
    console.log("Removed only this QA namespace and its submission files.");
    return;
  }
  async function login(username: string, expectedId: string) {
    const res = await fetch(base + "/api/auth/login", { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ username, password: state.password }) });
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    const check = await fetch(base + "/api/arena", { headers: { Cookie: cookie } });
    assert.equal((await check.json()).user.id, expectedId, "Server must use the isolated namespace before mutations");
    return cookie;
  }
  const admin = await login("qa_arena03_admin", state.adminId), student = await login("qa_arena03_user", state.userId);
  const arena = async () => (await (await fetch(`${base}/api/arena?round=${state.roundId}`, { headers: { Cookie: student } })).json());
  assert.equal((await arena()).canReadStatement, false);
  const round = (await db().get<Contest>(key(`round:${state.roundId}`)))!;
  await db().set(key(`round:${state.roundId}`), { ...round, startAt: Date.now() - 1000 });
  const publicView = await arena();
  assert.equal(publicView.tasks.length, 2); assert.equal(publicView.maxScore, 200);
  assert.equal(publicView.assets.length, 6); assert.ok(publicView.assets.every((a: { phase: string; name: string }) => a.phase === "public" && !/baseline|ipynb/i.test(a.name)));
  const pkg = (await db().get<ContestPackage>(key(`package:${state.version}`)))!;
  const privateAsset = pkg.assets.find((a) => a.phase === "private")!;
  const denied = await fetch(`${base}/api/download?round=${state.roundId}&asset=${encodeURIComponent(privateAsset.key)}`, { headers: { Cookie: student }, redirect: "manual" });
  assert.equal(denied.status, 403);
  const expected = JSON.parse(await readFile(root + "/qa/baseline_results.json", "utf8"));
  const results = [];
  async function upload(task: string, split: string, cookie: string, text?: string) {
    const data = text ?? await readFile(root + `/qa/notebook_runtime/Tac_vu_${task}/submission_${split}.csv`, "utf8");
    const form = new FormData(); form.set("task", task); form.set("split", split); form.set("nonce", randomUUID()); form.set("file", new File([data], "baseline.csv"));
    const res = await fetch(`${base}/api/submit?round=${state.roundId}`, { method: "POST", headers: { Cookie: cookie, Origin: base }, body: form });
    return { status: res.status, value: await res.json() };
  }
  for (const split of ["public", "private"]) {
    if (split === "private") {
      await db().set(key(`round:${state.roundId}`), { ...round, startAt: Date.now() - 3600000, privateAt: Date.now() - 1000, privateStartedAt: Date.now() - 1000, submissionAccess: { public: { visible: true, enabled: false }, private: { visible: true, enabled: true } } });
      assert.equal((await arena()).assets.length, 8);
    }
    for (const task of ["1", "2"]) {
      const result = await upload(task, split, student);
      assert.equal(result.status, 200, JSON.stringify(result.value));
      const ref = expected.find((r: { task: number; split: string }) => String(r.task) === task && r.split === split);
      assert.ok(Math.abs(result.value.score - ref.score) < 1e-9);
      assert.ok(Math.abs(result.value.secondary - ref.secondary) < 1e-9);
      assert.equal(result.value.adminTest, false);
      results.push({ task, split, score: result.value.score, secondary: result.value.secondary });
    }
  }
  const invalid = await upload("2", "private", student, "id,labels\npr_000001,28\n");
  assert.equal(invalid.status, 422);
  const adminTrial = await upload("2", "private", admin);
  assert.equal(adminTrial.status, 200); assert.equal(adminTrial.value.adminTest, true);
  const view = await arena();
  assert.equal(view.leaderboard.private.length, 1);
  assert.equal(view.leaderboard.public.length, 1);
  // Keep login state in this ignored file only so a browser can reuse the fixture.
  await writeFile(file, JSON.stringify({ ...state, adminCookie: admin, studentCookie: student }, null, 2));
  await writeFile(root + "/web_ready/release_20261030/internal/qa/http-flow.json", JSON.stringify({ version: state.version, namespace: state.namespace, results, publicAssets: 6, privateAssets: 8, baselineAssets: 0, privateLockedDuringPublic: true, invalidCsvRejected: true, adminExcludedFromLeaderboard: true }, null, 2));
  console.log("PASS HTTP login → locked materials → public → private → four baseline scores; invalid CSV rejected; admin trial excluded from rankings.");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
