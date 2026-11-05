/** Real SQL/Redis in a unique namespace. No provider calls or real GPU resources. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/lib/db";
import {
  namespace,
  query,
  sqlTransaction,
  closeSqlPools,
} from "../src/lib/sql";
import {
  createSqlUser,
  saveSqlPackage,
  readUser,
  readTeams,
} from "../src/lib/entity-repository";
import { sqlTeamAction } from "../src/lib/sql-teams";
import { createRound, control, getContest } from "../src/lib/rounds";
import { hashPassword } from "../src/lib/auth";
import { encryptSecret } from "../src/lib/workspace-crypto";
import { defaultTemplate, type Workspace } from "../src/lib/workspace-domain";
import { workspaceState } from "../src/lib/workspaces";
import type { User, SafeUser, ContestPackage } from "../src/lib/types";

async function main() {
  process.env.ARENA_DATABASE_MODE = "postgres";
  process.env.ARENA_NAMESPACE = `arena:qa:workspace-loading:${randomUUID()}`;
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const ns = namespace(),
    password = randomBytes(18).toString("base64url"),
    original = globalThis.fetch;
  let archivedWorkerReads = 0,
    providerCalls = 0,
    keep = false;
  const archivedIds = new Set<string>();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (/api\.groq\.com|api\.runpod\.io|rest\.runpod\.io/.test(url)) {
      providerCalls++;
      throw Error("Provider calls forbidden in loading QA");
    }
    if (
      typeof init?.body === "string" &&
      init.body.includes(":gpu:worker:") &&
      [...archivedIds].some((id) => init.body!.toString().includes(id))
    )
      archivedWorkerReads++;
    return original(input, init);
  };
  try {
    await query("insert into arena.state(ns,imported_at) values($1,$2)", [
      ns,
      Date.now(),
    ]);
    const hashed = await hashPassword(password);
    const makeUser = (username: string): User => ({
      id: randomUUID(),
      username,
      name: username,
      password: hashed,
      teamId: null,
      createdAt: Date.now(),
    });
    const a = makeUser("loading_admin"),
      u = makeUser("loading_member"),
      x = makeUser("loading_other");
    await createSqlUser(a, "primary");
    await createSqlUser(u);
    await createSqlUser(x);
    await sqlTeamAction(u.id, "create", { name: "Đội kiểm tra Workspace" });
    await sqlTeamAction(x.id, "create", { name: "Đội khác" });
    const member: SafeUser = { ...(await readUser(u.id))!, admin: false },
      outsider: SafeUser = { ...(await readUser(x.id))!, admin: false },
      admin: SafeUser = { ...a, admin: true };
    const team = (await readTeams())[member.teamId!];
    const pkg: ContestPackage = {
      version: randomUUID(),
      title: "Workspace loading QA",
      statement: "QA",
      tasks: [{ id: "1", title: "QA", content: "QA" }],
      assets: [],
      judges: {
        "1": { public: "qa", private: "qa" },
        "2": { public: "qa", private: "qa" },
      },
      importedAt: Date.now(),
    };
    await saveSqlPackage(pkg);
    const roundId = (await createRound("Vòng kiểm tra Workspace", pkg.version))
      .id;
    await control("start", {}, roundId);
    const c = await getContest(roundId);
    const hiddenId = (await createRound("Vòng ẩn", pkg.version)).id;
    await query(
      "update arena.rounds set configuration=jsonb_set(configuration,'{hidden}','true'::jsonb) where ns=$1 and id=$2",
      [ns, hiddenId],
    );
    const template = {
      ...defaultTemplate,
      name: "QA loading template",
      services: "llm" as const,
      imageName: "qa/image:test",
    };
    const now = Date.now(),
      secret = encryptSecret("qa-loading-only-secret");
    const record = (
      status: Workspace["status"],
      patch: Partial<Workspace> = {},
    ): Workspace => ({
      id: randomUUID(),
      scope: "all",
      services: "llm",
      teamId: null,
      teamName: "Dùng chung",
      roundId,
      runId: c.id,
      roundTitle: c.title,
      ownerId: a.id,
      podName: "QA only",
      podId: "qa-not-a-real-pod",
      status,
      template,
      secret,
      jupyterSecret: secret,
      createdAt: now,
      updatedAt: now,
      syncedAt: null,
      meterAt: now,
      meterRate: 0,
      accruedUsd: 0,
      quotedGpuRate: 0,
      health: null,
      error: null,
      ...patch,
    });
    const records = [
      record("stopped"),
      ...Array.from({ length: 85 }, () => record("terminated")),
      record("terminated", {
        scope: "team",
        teamId: member.teamId,
        teamName: team.name,
      }),
      record("terminated", { scope: "team", teamId: outsider.teamId }),
      record("terminated", { roundId: hiddenId }),
      record("terminated", { roundId: randomUUID() }),
    ];
    records
      .filter((w) => w.status === "terminated")
      .forEach((w) => archivedIds.add(w.id));
    await query(
      `insert into arena.runtime_history(ns,kind,id,round_id,run_id,owner_id,status,payload,expires_at,observed_at)
   select $1,'workspace',w->>'id',w->>'roundId',w->>'runId',w->>'ownerId',w->>'status',w,null,$3 from jsonb_array_elements($2::jsonb) w`,
      [ns, JSON.stringify(records), now],
    );
    const started = Date.now(),
      current = await workspaceState(admin, "current");
    const currentMs = Date.now() - started;
    assert.equal(current.workspaces.length, 1);
    assert.deepEqual(current.counts, { current: 1, history: 89 });
    assert.equal(archivedWorkerReads, 0);
    const history = await workspaceState(admin, "history");
    assert.equal(history.workspaces.length, 89);
    assert.equal(history.chatOperations.length, 0);
    assert.equal(history.chatGroups.length, 0);
    assert.equal(archivedWorkerReads, 0);
    const all = await workspaceState(admin);
    assert.equal(all.workspaces.length, 90);
    assert.equal(all.counts.history, history.workspaces.length);
    const own = await workspaceState(member, "history"),
      other = await workspaceState(outsider, "history");
    assert.equal(own.workspaces.length, 86);
    assert.equal(own.counts.history, 86);
    assert.equal(other.workspaces.length, 86);
    assert.ok(own.workspaces.some((w) => w.teamId === member.teamId));
    assert.ok(!own.workspaces.some((w) => w.teamId === outsider.teamId));
    assert.ok(!own.workspaces.some((w) => w.roundId === hiddenId));
    assert.ok(
      own.workspaces.every(
        (w) => !("secret" in w) && !("jupyterSecret" in w) && !("ownerId" in w),
      ),
    );
    assert.equal(
      (await workspaceState({ ...member, teamId: null }, "history")).counts
        .history,
      0,
    );
    assert.equal(providerCalls, 0);
    if (process.argv.includes("--keep")) {
      await mkdir(".local", { recursive: true });
      await writeFile(
        ".local/workspace-loading-browser.json",
        JSON.stringify({
          namespace: ns,
          password,
          admin: a.username,
          member: u.username,
          roundId,
          currentId: records[0].id,
        }),
      );
      await writeFile(
        ".local/workspace-loading-browser.env",
        `ARENA_NAMESPACE=${ns}\nARENA_DATABASE_MODE=postgres\nGPU_WORKSPACE_ENCRYPTION_KEY=${process.env.GPU_WORKSPACE_ENCRYPTION_KEY}\nGROQ_RUNNER_ENABLED=false\n`,
      );
      keep = true;
    }
    const proof = {
      result: "PASS",
      namespace: ns,
      currentMs,
      currentRows: 1,
      archivedRows: 89,
      archivedWorkerReads,
      providerCalls,
      checks: [
        "current/history split and backwards-compatible full state",
        "history counts respect membership, private scope and hidden/deleted rounds",
        "archived rows do not read worker telemetry",
        "contestant DTOs retain redaction",
      ],
      keptForBrowser: keep,
    };
    await mkdir(".local", { recursive: true });
    await writeFile(
      ".local/workspace-loading-qa-result.json",
      JSON.stringify(proof, null, 2),
    );
    console.log(JSON.stringify(proof));
  } finally {
    globalThis.fetch = original;
    if (!keep) {
      assert.ok(
        namespace() === ns && ns.startsWith("arena:qa:workspace-loading:"),
      );
      const tables = [
        "team_members",
        "team_invites",
        "admins",
        "users",
        "teams",
        "packages",
        "rounds",
        "runs",
        "registrations",
        "announcements",
        "submissions",
        "submission_quotas",
        "requests",
        "gpu_templates",
        "gpu_credentials",
        "api_credentials",
        "runtime_history",
        "audit_events",
        "legacy_archive",
        "migration_runs",
        "state",
      ];
      await sqlTransaction(async (client) => {
        for (const table of tables)
          await client.query(`delete from arena.${table} where ns=$1`, [ns]);
      }, true);
      let cursor = "0";
      const keys: string[] = [];
      do {
        const [next, found] = await db().scan(cursor, {
          match: ns + ":*",
          count: 100,
        });
        keys.push(...found);
        cursor = String(next);
      } while (cursor !== "0");
      assert.ok(keys.every((k) => k.startsWith(ns + ":")));
      for (let i = 0; i < keys.length; i += 100)
        await db().del(...keys.slice(i, i + 100));
    }
    await closeSqlPools();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : "Workspace loading QA failed");
  process.exitCode = 1;
});
