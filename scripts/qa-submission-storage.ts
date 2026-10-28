/** HTTP + real Redis/Blob, isolated QA keys; never changes a production round. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, key } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import type { Contest, ContestPackage, Submission } from "../src/lib/types";

const statePath = ".local/qa-submission-storage.json";
const base = "http://localhost:3011";
async function main() {
  if (process.argv.includes("--setup")) {
    const source = await db().get<Contest>(
      key("round:8497dfaa-a273-454c-b085-ad4b2299a090"),
    );
    assert.ok(source?.packageId);
    const pkg = await db().get<ContestPackage>(
      key(`package:${source.packageId}`),
    );
    assert.ok(pkg);
    const namespace = `arena:qa:submission:${randomUUID()}`;
    process.env.ARENA_NAMESPACE = namespace;
    const round = randomUUID(),
      run = randomUUID(),
      password = "QA-Submission-Only-2026!";
    const hash = await hashPassword(password);
    const tx = db()
      .multi()
      .set(key(`package:${source.packageId}`), pkg)
      .set(key(`round:${round}`), {
        ...source,
        roundId: round,
        id: run,
        title: "QA submission storage",
        hidden: false,
        startAt: Date.now() - 1000,
        privateAt: null,
        forcedEndAt: null,
        unlimited: true,
        publicLimit: 1,
      })
      .zadd(key("rounds"), { score: Date.now(), member: round })
      .set(key("admin"), "qa-admin")
      .hset(key(`registrations:${round}`), {
        "qa-user": { userId: "qa-user", status: "approved" },
        "qa-other": { userId: "qa-other", status: "approved" },
      })
      .hset(key("teams"), {
        "qa-team": {
          id: "qa-team",
          name: "QA team",
          members: ["qa-user"],
          captainId: "qa-user",
          inviteCode: "qa",
          createdAt: Date.now(),
        },
      });
    for (const id of ["qa-admin", "qa-user", "qa-other"])
      tx.set(key(`user:${id}`), {
        id,
        username: id,
        name: id,
        password: hash,
        teamId:
          id === "qa-admin"
            ? null
            : id === "qa-user"
              ? "qa-team"
              : "qa-other-team",
        createdAt: Date.now(),
      }).set(key(`username:${id}`), id);
    await tx.exec();
    await writeFile(
      statePath,
      JSON.stringify({ namespace, round, run, password }),
    );
    console.log(
      "Created isolated submission QA fixture. Start Next on port 3011 with its namespace.",
    );
    return;
  }
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.ok(state.namespace.startsWith("arena:qa:submission:"));
  process.env.ARENA_NAMESPACE = state.namespace;
  if (process.argv.includes("--cleanup")) {
    let cursor = "0";
    do {
      const [next, keys] = await db().scan(cursor, {
        match: key("*"),
        count: 100,
      });
      cursor = String(next);
      if (keys.length) await db().del(...keys);
    } while (cursor !== "0");
    console.log("Removed this run's QA keys only.");
    return;
  }
  const cookies: string[] = [];
  async function login(username: string) {
    const r = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: state.password }),
    });
    assert.equal(r.status, 200);
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    cookies.push(cookie);
    return cookie;
  }
  async function send(
    cookie: string,
    task: string,
    split: string,
    csv: string,
    nonce = randomUUID(),
  ) {
    const form = new FormData();
    form.set("task", task);
    form.set("split", split);
    form.set("nonce", nonce);
    form.set("file", new File([csv], "dự đoán.csv", { type: "text/csv" }));
    const r = await fetch(`${base}/api/submit?round=${state.round}`, {
      method: "POST",
      headers: { Origin: base, Cookie: cookie },
      body: form,
    });
    return { status: r.status, data: await r.json() };
  }
  try {
    const admin = await login("qa-admin"),
      user = await login("qa-user"),
      other = await login("qa-other");
    const root = resolve("../statements/Arena_02/web_ready");
    const fixtures = JSON.parse(
      await readFile(resolve(root, "qa/judge_fixtures.json"), "utf8"),
    );
    let firstCsv = "",
      firstTask = "";
    for (const task of ["1", "2", "3"])
      for (const split of ["public", "private"]) {
        const f = fixtures.find(
          (f: { task: string; split: string; csv: string }) =>
            f.task === task && f.split === split && f.csv.includes("synthetic"),
        );
        const csv = await readFile(resolve(root, f.csv), "utf8");
        const result = await send(admin, task, split, csv);
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.equal(result.data.score, f.score);
        const record = await db().hget<Submission>(
          key(`submissions:${state.run}`),
          result.data.id,
        );
        assert.equal(record?.fileStorage, "redis");
        const downloaded = await fetch(
          `${base}/api/submission/download?round=${state.round}&id=${record!.id}`,
          { headers: { Cookie: admin } },
        );
        assert.equal(downloaded.status, 200);
        assert.equal(await downloaded.text(), csv);
        assert.match(
          downloaded.headers.get("content-disposition")!,
          /filename\*=UTF-8/,
        );
        if (task === "1" && split === "public") {
          firstCsv = csv;
          firstTask = task;
        }
      }
    const nonce = randomUUID();
    const [a, b] = await Promise.all([
      send(user, firstTask, "public", firstCsv, nonce),
      send(user, firstTask, "public", firstCsv, nonce),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.data.id, b.data.id);
    assert.equal(await db().get(key(`quota:${state.run}:qa-team:1:public`)), 1);
    assert.equal((await send(user, "1", "public", firstCsv)).status, 409);
    const invalid = await send(user, "2", "public", "id,wrong\nmissing,0\n");
    assert.equal(invalid.status, 422);
    assert.equal(invalid.data.status, "invalid");
    assert.equal(
      await db().exists(key(`quota:${state.run}:qa-team:2:public`)),
      0,
    );
    const forbidden = await fetch(
      `${base}/api/submission/download?round=${state.round}&id=${a.data.id}`,
      { headers: { Cookie: other } },
    );
    assert.equal(forbidden.status, 404);
    const snapshot = await (
      await fetch(`${base}/api/arena?round=${state.round}`, {
        headers: { Cookie: user },
      })
    ).json();
    assert.equal(snapshot.submissions.length, 2);
    assert.ok(
      snapshot.submissions.every(
        (s: Record<string, unknown>) =>
          !s.path && !s.fileStorage && s.downloadable,
      ),
    );
    assert.equal(
      (await db().keys(key("submission-file:*"))).length,
      8,
      "duplicate/quota orphaned a file",
    );
    await writeFile(
      ".local/qa-submission-snapshot.json",
      JSON.stringify(snapshot),
    );
    console.log(
      "PASS real HTTP/Redis/Blob: six task/split scores, compressed fallback, exact CSV downloads, cross-team denial, simultaneous idempotency, quota and invalid history; no model or production writes.",
    );
  } finally {
    for (const cookie of cookies)
      await fetch(base + "/api/auth/logout", {
        method: "POST",
        headers: { Origin: base, Cookie: cookie },
      });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
