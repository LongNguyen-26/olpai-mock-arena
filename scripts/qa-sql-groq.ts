/** Real SQL, isolated namespace; no Redis credentials, provider/Pod calls mocked. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { namespace, query, sqlTransaction, closeSqlPools } from "../src/lib/sql";
import { createSqlUser, readUser, readTeams, saveSqlPackage } from "../src/lib/entity-repository";
import { sqlTeamAction } from "../src/lib/sql-teams";
import { createRound, getContest, control, registerRound } from "../src/lib/rounds";
import { changeGroqCredential, createGroqChatbot } from "../src/lib/groq-service";
import { controlChatGroup } from "../src/lib/chat-groups";
import { enqueueChat, groqQueueAction, readQueuedChat, chatQueueSummary, settleUncertain, type WorkerRequest } from "../src/lib/chat-queue";
import { sqlChatJob, sqlActiveGroqJobs } from "../src/lib/sql-chat";
import { pumpGroqGroup } from "../src/lib/groq-runner";
import { sessionUser, saveSession, removeSession, consumeCounter, acquireLease, releaseLease, runtimeSignal, saveRuntimeSignal } from "../src/lib/sql-runtime";
import { readSubmissionFile, saveSqlSubmissionFile } from "../src/lib/submission-storage";
import { chatHistory } from "../src/lib/chat-history";
import { workspaceState } from "../src/lib/workspaces";
import { requireRunpod } from "../src/lib/runtime-mode";
import type { User, SafeUser, ContestPackage } from "../src/lib/types";
import { hashPassword } from "../src/lib/auth";
import { exportSqlSnapshot } from "../src/lib/database-rollback";
import { importSnapshot, verifySnapshot, importColumns, saveEncryptedSnapshot, loadEncryptedSnapshot } from "../src/lib/database-snapshot";

async function main() {
  assert.ok(process.env.ARENA_DATABASE_URL);
  process.env.ARENA_DATABASE_MODE = "postgres";
  process.env.ARENA_NAMESPACE = `arena:qa:sql-groq:${randomUUID()}`;
  process.env.ARENA_RUNPOD_MODE = "disabled";
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const ns = namespace(), originalFetch = globalThis.fetch, checks: string[] = [];
  const keepRequested = process.argv.includes("--keep"), qaPassword = randomBytes(18).toString("hex");
  let kept = false;
  let inferences = 0, blockedNetwork = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "https://api.groq.com/openai/v1/models") return Response.json({ data: [{ id: "openai/gpt-oss-20b", context_window: 131072, max_completion_tokens: 4096 }] });
    if (url === "https://api.groq.com/openai/v1/chat/completions") {
      inferences++;
      return Response.json({ id: `qa-${inferences}`, choices: [{ message: { content: "SQL QA reply" }, finish_reason: "stop" }], usage: { prompt_tokens: 32, completion_tokens: 8 } });
    }
    blockedNetwork++; throw new Error("QA blocked unexpected network endpoint");
  };
  const user = (name: string): User => ({ id: randomUUID(), username: name, name, password: "qa-unused-hash", teamId: null, createdAt: Date.now() });
  const a = user("sql_groq_admin"), u = user("sql_groq_member"), other = user("sql_groq_other");
  const admin: SafeUser = { ...a, admin: true };
  try {
    a.password = await hashPassword(qaPassword);
    await query("insert into arena.state(ns,imported_at) values($1,$2)", [ns, Date.now()]);
    await createSqlUser(a, "primary"); await createSqlUser(u); await createSqlUser(other);
    await sqlTeamAction(u.id, "create", { name: "SQL Groq QA" });
    const member: SafeUser = { ...(await readUser(u.id))!, admin: false };
    const pkg: ContestPackage = { version: randomUUID(), title: "SQL Groq QA", statement: "QA", tasks: [{ id: "1", title: "QA", content: "QA" }], assets: [], judges: { "1": { public: "qa", private: "qa" }, "2": { public: "qa", private: "qa" } }, importedAt: Date.now() };
    await saveSqlPackage(pkg);
    const { id: roundId } = await createRound("SQL Groq QA", pkg.version);
    await registerRound(member, roundId);
    let c = await getContest(roundId);
    await control("practice-open", { runId: c.id, revision: c.revision ?? 0, requestId: randomUUID(), endAt: null, publicVisible: true, privateVisible: true, chatbotEnabled: true, chatbotUntil: null, notebookEnabled: false }, roundId);
    c = await getContest(roundId);
    await changeGroqCredential(admin, "qa-fake-api-key");
    const allocation = { id: randomUUID(), name: "SQL QA Groq", model: "openai/gpt-oss-20b", scope: "team" as const, teamId: member.teamId, roundId,
      policy: { tokenLimitMode: "turn" as const, sessionTokenLimit: 4096, inputTokenLimit: 1024, outputTokenLimit: 256 }, parallel: 2, requestsPerMinute: 20 };
    await createGroqChatbot(admin, allocation);
    assert.equal((await createGroqChatbot(admin, allocation)).id, allocation.id);
    await assert.rejects(() => createGroqChatbot(admin, { ...allocation, id: randomUUID() }), /đã có Chatbot/);
    checks.push("SQL-only allocation, credential/configuration lock and duplicate reservation");

    await saveSession("qa-hash", member.id, Date.now() + 60_000); assert.equal(await sessionUser("qa-hash"), member.id);
    await removeSession("qa-hash"); assert.equal(await sessionUser("qa-hash"), undefined);
    await saveSession("qa-expired", member.id, Date.now() - 1); assert.equal(await sessionUser("qa-expired"), undefined);
    const rates = await Promise.all(Array.from({ length: 8 }, () => consumeCounter("qa-rate", 60, 3)));
    assert.equal(rates.filter(Boolean).length, 3);
    const leases = await Promise.all(Array.from({ length: 5 }, (_, i) => acquireLease("qa-lease", String(i), 60)));
    assert.equal(leases.filter(Boolean).length, 1);
    await releaseLease("qa-lease", "not-the-owner"); assert.equal(await acquireLease("qa-lease", "new", 60), false);
    await saveRuntimeSignal("qa-cooldown", "true", 60); assert.equal(await runtimeSignal("qa-cooldown"), "true");
    checks.push("session expiry/logout, concurrent rate ceiling, lease ownership and cooldown");

    const groupId = allocation.id, sessionId = randomUUID(), requestId = randomUUID();
    const send = (sid = randomUUID(), rid = randomUUID(), content = "QA prompt") => enqueueChat(member, undefined, sid, rid, content, groupId, c.id);
    const duplicates = await Promise.all(Array.from({ length: 4 }, () => send(sessionId, requestId)));
    assert.equal(new Set(duplicates.map(r => r.requestId)).size, 1);
    await assert.rejects(() => send(sessionId, requestId, "different"), /nội dung khác/);
    await assert.rejects(() => enqueueChat({ ...other, admin: false }, undefined, randomUUID(), randomUUID(), "QA", groupId, c.id), /không thuộc đội/);
    await send(); await send(); await send(); await assert.rejects(() => send(), /4 prompt/);
    assert.equal((await chatQueueSummary(`group:${groupId}`, c.id)).queued, 4);
    const v = (slot: number): WorkerRequest => ({ workspaceId: `groq:${groupId}`, protocol: 2, ready: true, fingerprint: "groq:qa", slot, capacity: 2 });
    const claims = await Promise.all([0, 1, 0].map(slot => groqQueueAction("claim", v(slot), groupId))) as { job?: { requestId: string; attempt: string; slot: number } | null }[];
    assert.equal(claims.filter(r => r.job).length, 2);
    const claim = claims.find(r => r.job)!.job!, bound = { ...v(claim.slot), requestId: claim.requestId, attempt: claim.attempt };
    assert.equal((await groqQueueAction("prepare", { ...bound, promptTokens: 128 }, groupId) as { execute: boolean }).execute, true);
    assert.equal((await groqQueueAction("prepare", { ...bound, promptTokens: 128 }, groupId) as { execute: boolean }).execute, false);
    await assert.rejects(() => groqQueueAction("complete", { ...bound, attempt: randomUUID(), inputTokens: 32, outputTokens: 8, content: "late" }, groupId), /không thuộc/);
    await groqQueueAction("persist-result", { ...bound, inputTokens: 32, outputTokens: 8, content: "persisted reply" }, groupId);
    await pumpGroqGroup(groupId, true);
    assert.equal((await sqlChatJob(claim.requestId))?.status, "completed");
    await groqQueueAction("complete", { ...bound, inputTokens: 32, outputTokens: 8, content: "duplicate reply" }, groupId);
    const completed = (await readQueuedChat(member, undefined, sessionId, groupId)).session;
    assert.ok(completed.messages.length >= 1);
    checks.push("concurrent duplicate enqueue, ownership, four-prompt limit, slot capacity, stale attempts and persist/finalize replay");

    // Settle every remaining claimed/running job without retrying inference.
    for (const j of await sqlActiveGroqJobs(groupId)) if (j.attempt && (j.status === "running" || j.status === "claimed")) {
      const b = { ...v(j.slot!), requestId: j.id, attempt: j.attempt };
      if (j.status === "claimed") await groqQueueAction("prepare", { ...b, promptTokens: 128 }, groupId);
      await groqQueueAction("api-uncertain", { ...b, safeError: "QA uncertain" }, groupId);
      await settleUncertain(admin, j.id);
    }
    await pumpGroqGroup(groupId, true);
    const history = await chatHistory(member, undefined, groupId); assert.ok(history.items.length >= 4);
    const state = await workspaceState(admin, "current"); assert.equal(state.runpodMode, "disabled"); assert.ok(state.chatGroups.some(g => g.id === groupId));
    const bytes = Buffer.from("id,label\n1,qa\n"); await saveSqlSubmissionFile("qa-csv", bytes);
    assert.deepEqual(await readSubmissionFile({ path: "qa-csv", fileStorage: "postgres" }), bytes);
    assert.throws(() => requireRunpod(), /tạm ngừng/);
    process.env.ARENA_RUNPOD_MODE = "draining"; requireRunpod(); assert.throws(() => requireRunpod(true), /tạm ngừng/);
    process.env.ARENA_RUNPOD_MODE = "disabled";
    await controlChatGroup(admin, groupId, "pause");
    await assert.rejects(() => send(), /tạm ngừng/);
    checks.push("SQL history/Workspace and CSV fallback without Redis; Runpod off/draining gates; pause blocks new prompts");
    const snapshot = await sqlTransaction(() => exportSqlSnapshot(), true);
    const backup = `.local/database-backups/sql-runtime-qa-${randomUUID()}.json.enc`;
    await saveEncryptedSnapshot(snapshot, backup);
    const decoded = await loadEncryptedSnapshot(backup), restoreNs = ns + ":restore";
    try {
      process.env.ARENA_NAMESPACE = restoreNs;
      await importSnapshot(decoded);
      assert.equal((await verifySnapshot(decoded)).result, "PASS");
      assert.deepEqual(await readSubmissionFile({ path: "qa-csv", fileStorage: "postgres" }), bytes);
    } finally {
      await sqlTransaction(async client => {
        for (const table of [...Object.keys(importColumns).reverse(), "migration_runs", "state"])
          await client.query(`delete from arena.${table} where ns=$1`, [restoreNs]);
      });
      process.env.ARENA_NAMESPACE = ns;
    }
    checks.push("encrypted native SQL backup restores sessions, runtime controls and exact CSV bytes without Redis");
    assert.equal(blockedNetwork, 0);
    const proof = { result: "PASS", namespace: ns, checks, realSQL: true, redisCredentials: false, unexpectedNetwork: blockedNetwork, mockedInferences: inferences, paidResources: 0 };
    await mkdir(".local", { recursive: true }); await writeFile(".local/sql-groq-qa-result.json", JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
    if (keepRequested) {
      await writeFile(".local/sql-groq-http-fixture.json", JSON.stringify({ namespace: ns, username: a.username, password: qaPassword, encryptionKey: process.env.GPU_WORKSPACE_ENCRYPTION_KEY, groupId, roundId }));
      kept = true;
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (!kept) await sqlTransaction(async client => {
      for (const table of ["sessions", "rate_counters", "runtime_leases", "runtime_signals", "chat_lanes", "submission_files", "team_members", "team_invites", "admins", "users", "teams", "packages", "rounds", "runs", "registrations", "announcements", "submissions", "submission_quotas", "requests", "gpu_templates", "gpu_credentials", "api_credentials", "runtime_history", "audit_events", "legacy_archive", "migration_runs", "state"])
        await client.query(`delete from arena.${table} where ns=$1`, [ns]);
    });
    await closeSqlPools();
  }
}
main().catch(error => { console.error(error instanceof Error ? `${error.name}: ${error.message}\n${error.stack?.split("\n").filter(l => l.includes("qa-sql-groq.ts")).join("\n") ?? ""}` : "SQL Groq QA failed"); process.exitCode = 1; });
