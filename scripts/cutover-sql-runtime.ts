/** One-time runtime cutover. Dry-run by default; preserves all Redis keys. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { db, key } from "../src/lib/db";
import { namespace, query, sqlTransaction, closeSqlPools, sqlNow } from "../src/lib/sql";
import { syncRuntimeHistory } from "../src/lib/runtime-authority";
import { saveSession } from "../src/lib/sql-runtime";
import { readSubmissionFile, saveSqlSubmissionFile } from "../src/lib/submission-storage";
import { exportSqlSnapshot } from "../src/lib/database-rollback";
import { saveEncryptedSnapshot, loadEncryptedSnapshot } from "../src/lib/database-snapshot";
import type { ChatGroup } from "../src/lib/chat-groups";
import type { Workspace } from "../src/lib/workspace-domain";
import type { Submission } from "../src/lib/types";

async function main() {
  assert.equal(process.env.ARENA_DATABASE_MODE, "postgres");
  const apply = process.argv.includes("--apply"), ns = namespace();
  const freezeId = process.argv.find(v => v.startsWith("--freeze-id="))?.slice(12);
  if (apply && (!process.argv.includes("--production") || ns !== "arena:v1" || !freezeId)) throw new Error("Apply requires --production, arena:v1 and the exact --freeze-id");
  const state = (await query("select maintenance,configuration from arena.state where ns=$1", [ns]))[0];
  if (!apply && !state?.maintenance) await syncRuntimeHistory(10000);
  if (await db().hlen(key("sql:runtime:pending"))) throw new Error("Pending history must be replayed before cutover");
  const sqlActive = await query("select 1 from arena.runtime_history where ns=$1 and ((kind='workspace' and status not in ('terminated','failed')) or (kind='chat-job' and status in ('queued','claimed','running','uncertain') and (expires_at is null or expires_at>$2))) limit 1", [ns, await sqlNow()]);
  if (sqlActive.length) throw new Error("Active SQL jobs/Workspaces must be drained first");
  const ids = await db().smembers<string[]>(key("gpu:workspaces"));
  const workspaces = ids.length ? await db().mget<(Workspace | null)[]>(...ids.map(id => key(`gpu:workspace:${id}`))) : [];
  if (workspaces.some(w => w && !["terminated", "failed"].includes(w.status))) throw new Error("Active Redis Workspace must be drained first");
  const groups = (await query("select payload from arena.runtime_history where ns=$1 and kind='chat-group'", [ns])).map(r => r.payload as ChatGroup);
  for (const g of groups) {
    if (g.provider !== "groq") continue;
    const active = await db().zrange<string[]>(key(`gpu:jobs:group:${g.id}:${g.runId}`), 0, 255);
    const jobs = active.length ? await db().mget<({ status: string } | null)[]>(...active.map(id => key(`gpu:job:${id}`))) : [];
    if (jobs.some(j => j && ["queued", "claimed", "running", "uncertain"].includes(j.status))) throw new Error("Redis Groq queue must be drained first");
  }
  const files = await query("select id,path,sha256 from arena.submissions where ns=$1 and file_storage='redis'", [ns]);
  const fileBytes = new Map<string, Buffer>();
  for (const f of files) {
    if (!String(f.path).startsWith(key("submission-file:"))) throw new Error("Unexpected Redis fallback location");
    const bytes = await readSubmissionFile({ path: f.path, fileStorage: "redis" });
    assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256, "CSV checksum mismatch");
    fileBytes.set(String(f.id), bytes);
  }
  if (!apply) { console.log(JSON.stringify({ ready: true, namespace: ns, activeWorkspaces: 0, activeJobs: 0, fallbackFiles: files.length, redisKeysDeleted: 0 })); return; }
  assert.equal(state.maintenance, true); assert.equal(state.configuration.runtimeFreezeId, freezeId);
  process.env.ARENA_RUNPOD_MODE = "enabled";
  const backup = `.local/database-backups/before-sql-runtime-${Date.now()}-${randomUUID()}.json.enc`;
  const before = await sqlTransaction(() => exportSqlSnapshot());
  await saveEncryptedSnapshot(before, backup); assert.equal((await loadEncryptedSnapshot(backup)).checksum, before.checksum);
  const sessions: { hash: string; user: string; expiry: number }[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await db().scan(cursor, { match: key("session:*") , count: 100 }); cursor = String(next);
    for (const k of keys) {
      const hash = k.slice(key("session:").length); if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Unexpected session identity");
      const [user, ttl] = await Promise.all([db().get<string>(k), db().pttl(k)]);
      if (user && ttl > 0) sessions.push({ hash, user, expiry: Date.now() + ttl });
    }
  } while (cursor !== "0");
  await sqlTransaction(async client => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [ns]);
    const locked = (await client.query("select maintenance,configuration from arena.state where ns=$1", [ns])).rows[0];
    if (!locked?.maintenance || locked.configuration.runtimeFreezeId !== freezeId) throw new Error("Freeze changed; no cutover writes");
    for (const s of sessions) {
      if ((await client.query("select 1 from arena.users where ns=$1 and id=$2 and deleted_at is null", [ns, s.user])).rowCount) await saveSession(s.hash, s.user, s.expiry);
    }
    for (const f of files) {
      await saveSqlSubmissionFile(f.id, fileBytes.get(String(f.id))!);
      await client.query("update arena.submissions set path=id,file_storage='postgres' where ns=$1 and id=$2 and file_storage='redis' and path=$3", [ns, f.id, f.path]);
    }
  });
  for (const f of files) assert.deepEqual(await readSubmissionFile({ path: f.id, fileStorage: "postgres" }), fileBytes.get(String(f.id)));
  process.env.ARENA_RUNPOD_MODE = "disabled";
  const after = await sqlTransaction(() => exportSqlSnapshot());
  const afterBackup = `.local/database-backups/after-sql-runtime-${Date.now()}-${randomUUID()}.json.enc`;
  await saveEncryptedSnapshot(after, afterBackup); assert.equal((await loadEncryptedSnapshot(afterBackup)).checksum, after.checksum);
  const proof = { migrated: true, namespace: ns, sessions: sessions.length, fallbackFiles: files.length, redisKeysDeleted: 0, beforeBackup: backup, afterBackup, afterChecksum: after.checksum };
  await mkdir(".local", { recursive: true }); await writeFile(".local/sql-runtime-cutover-result.json", JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Runtime cutover failed"); process.exitCode = 1; }).finally(() => closeSqlPools());
