import { createHash, randomUUID } from "node:crypto";
import { db, key, serverNow } from "./db";
import { readGroupIds } from "./gpu-repository";
import { usingPostgres, query, namespace } from "./sql";
import { getChatGroup, type ChatGroup } from "./chat-groups";
import { getContest } from "./rounds";
import { groqOwnerActive } from "./groq-service";
import { readApiCredential } from "./api-credentials";
import { decryptSecret } from "./workspace-crypto";
import { groqComplete, GroqError, groqPromptReservation, fitGroqHistory, type GroqMessage } from "./groq";
import { groqQueueAction, chatQueueSummary, activeJobsKey, jobKey, type ChatJob, type WorkerRequest } from "./chat-queue";
import { runtimeEval } from "./runtime-authority";
import { chatbotOpen } from "./workspace-domain";
import type { ChatPolicy } from "./chat-policy";
import { initializeGroqRunner, groqRunnerState } from "./groq-runner-state";
import { acquireLease, releaseLease, consumeCounter, refundCounter, runtimeSignal, saveRuntimeSignal, clearRuntimeSignal, cleanupSqlRuntime } from "./sql-runtime";
import { sqlActiveGroqJobs } from "./sql-chat";

type Result = Awaited<ReturnType<typeof groqComplete>>;
type ApiJob = ChatJob & { apiResult?: Result };
type Claim = { requestId: string; attempt: string; slot: number; messages: GroqMessage[]; template: ChatPolicy; inputTokens: number; outputTokens: number };
const inFlight = new Set<string>();
const safeMessage = (e: unknown) => e instanceof GroqError ? e.message : "Chưa hoàn tất xử lý Groq. Vui lòng thử lại sau hoặc báo admin.";

async function applyResult(g: ChatGroup, v: WorkerRequest, result: Result) {
  if (usingPostgres()) {
    await groqQueueAction("persist-result", { ...v, ...result }, g.id);
    return groqQueueAction("complete", { ...v, ...result }, g.id);
  }
  // Persist the result before finalizing. Replays only finalize this result;
  // they never call inference again, even after a process restart.
  await runtimeEval(`local raw=redis.call('GET',KEYS[1]);if not raw then return 0 end;local j=cjson.decode(raw)
    if j.attempt~=ARGV[1] or (j.status~='running' and j.status~='uncertain') then return 0 end
    j.apiResult=cjson.decode(ARGV[2]);redis.call('SET',KEYS[1],cjson.encode(j),'KEEPTTL');return 1`,
    [jobKey(v.requestId!)], [v.attempt!, JSON.stringify(result)]);
  return groqQueueAction("complete", { ...v, ...result }, g.id);
}
async function runSlot(g: ChatGroup, slot: number) {
  const local = `${g.id}:${slot}`;
  if (inFlight.has(local) || !g.groq) return;
  inFlight.add(local);
  const leaseKey = usingPostgres() ? `groq:executor:${local}` : key(`groq:executor:${local}`), token = randomUUID();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let rateKey: string | undefined, counted = false, sent = false;
  try {
    if (!(usingPostgres() ? await acquireLease(leaseKey, token, 180) : await db().set(leaseKey, token, { nx: true, ex: 180 }))) return;
    const credential = await readApiCredential(g.ownerId);
    if (!credential || !await groqOwnerActive(g.ownerId)) return;
    const apiKey = decryptSecret(credential.ciphertext);
    const rateId = createHash("sha256").update(apiKey).digest("hex");
    const cooldownKey = usingPostgres() ? `groq:cooldown:${rateId}` : key(`groq:cooldown:${rateId}`);
    if (usingPostgres() ? await runtimeSignal(cooldownKey) : await db().exists(cooldownKey)) return;
    const c = await getContest(g.roundId);
    const q = await chatQueueSummary(`group:${g.id}`, c.id);
    if (!q.queued) return;
    // Aggregate all chatbots using this key/model. A 429 applies a key-wide
    // cooldown; Groq remains authoritative for organization-wide token limits.
    rateKey = `groq:rate:${rateId}:${g.groq.id}:${Math.floor(Date.now() / 60_000)}`;
    if (!usingPostgres()) rateKey = key(rateKey);
    const allowed = usingPostgres() ? await consumeCounter(rateKey, 60, g.groq.requestsPerMinute) : await db().eval<number[], number>(`local n=tonumber(redis.call('GET',KEYS[1]) or '0');if n>=tonumber(ARGV[1]) then return 0 end;n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end;return 1`, [rateKey], [g.groq.requestsPerMinute]);
    if (!allowed) return;
    counted = true;
    let v: WorkerRequest = { workspaceId: `groq:${g.id}`, protocol: 2, ready: true,
      fingerprint: `groq:${g.groq.id}`, slot, capacity: g.groq.parallel };
    const claimed = await groqQueueAction("claim", v, g.id) as { job?: Claim | null };
    if (!claimed?.job) return;
    const job = claimed.job;
    v = { ...v, requestId: job.requestId, attempt: job.attempt };
    heartbeat = setInterval(() => { void groqQueueAction("heartbeat", v, g.id).catch(() => {}); }, 10_000);
    heartbeat.unref();
    const messages = fitGroqHistory(job.messages, Math.min(job.template.inputTokenLimit,
      job.template.sessionTokenLimit - job.inputTokens - job.outputTokens - 1,
      job.template.tokenLimitMode === "session" ? job.template.inputTokenLimit - job.inputTokens : Infinity));
    const promptTokens = groqPromptReservation(messages);
    // Credential changes require every group paused and every queue empty.
    // This claimed job therefore prevents rotation while it can call inference.
    if ((await readApiCredential(g.ownerId))?.revision !== credential.revision) {
      await groqQueueAction("api-requeue", v, g.id); return;
    }
    const prepared = await groqQueueAction("prepare", { ...v, promptTokens }, g.id) as { execute?: boolean; maxTokens?: number };
    if (!prepared.execute || !prepared.maxTokens) return;
    let result: Result;
    try {
      sent = true;
      result = await groqComplete(apiKey, g.groq.id, messages, Math.min(prepared.maxTokens, g.groq.maxCompletionTokens));
    } catch (error) {
      const message = safeMessage(error);
      if (usingPostgres()) await saveRuntimeSignal(`groq:error:${g.id}`, message, 3600);
      else await db().set(key(`groq:error:${g.id}`), message, { ex: 3600 });
      if (error instanceof GroqError && error.kind === "rate_limit") {
        if (usingPostgres()) await saveRuntimeSignal(cooldownKey, "true", error.retryAfter);
        else await db().set(cooldownKey, true, { ex: error.retryAfter });
        // A documented 429 rejects inference. Its reservation may be refunded.
        await groqQueueAction("api-requeue", { ...v, safeError: message }, g.id);
      } else await groqQueueAction(error instanceof GroqError && error.kind === "rejected" ? "api-rejected" : "api-uncertain", { ...v, safeError: message }, g.id);
      return;
    }
    await applyResult(g, v, result);
    if (usingPostgres()) await clearRuntimeSignal(`groq:error:${g.id}`);
    else await db().del(key(`groq:error:${g.id}`));
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    inFlight.delete(local);
    if (counted && !sent && rateKey) {
      if (usingPostgres()) await refundCounter(rateKey);
      else await db().eval("if tonumber(redis.call('GET',KEYS[1]) or '0')>0 then return redis.call('DECR',KEYS[1]) end;return 0", [rateKey], []);
    }
    if (usingPostgres()) await releaseLease(leaseKey, token);
    else await db().eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end;return 0", [leaseKey], [token]);
  }
}

export async function pumpGroqGroup(id: string, strict = false) {
  const g = await getChatGroup(id);
  if (g.provider !== "groq" || !g.groq || g.retired || !await groqOwnerActive(g.ownerId)) return;
  const c = await getContest(g.roundId), now = await serverNow();
  const summary = await chatQueueSummary(`group:${id}`, c.id);
  if (!chatbotOpen({ runId: c.id, services: "llm" }, c, now)) return;
  const pending = usingPostgres() ? await sqlActiveGroqJobs(id) : await Promise.all((await db().zrange<string[]>(activeJobsKey(`group:${id}`, c.id), 0, 255)).map(jobId => db().get<ApiJob>(jobKey(jobId))));
  for (const j of pending) {
    if (j?.apiResult && ["running", "uncertain"].includes(j.status))
      await applyResult(g, { workspaceId: `groq:${id}`, protocol: 2, ready: true, fingerprint: `groq:${g.groq.id}`,
        capacity: g.groq.parallel, slot: j.slot, requestId: j.id, attempt: j.attempt }, j.apiResult);
  }
  if (!summary.queued || g.paused) return;
  await Promise.allSettled(Array.from({ length: g.groq.parallel }, (_, slot) => runSlot(g, slot))).then(results => {
    const failed = results.find(r => r.status === "rejected");
    if (strict && failed?.status === "rejected") throw failed.reason;
    if (results.some(r => r.status === "rejected")) console.warn("Arena Groq executor will reconcile pending work");
  });
}
export function startGroqRunner() {
  if (!initializeGroqRunner()) return;
  let busy = false, lastCleanup = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    const state = groqRunnerState()!;
    state.lastPollAt = Date.now();
    try {
      const ids = usingPostgres()
        ? (await query(`select g.id from arena.runtime_history g where g.ns=$1 and g.kind='chat-group' and g.payload->>'provider'='groq'
            and coalesce((g.payload->>'retired')::boolean,false)=false and (coalesce((g.payload->>'paused')::boolean,false)=false
              or exists(select 1 from arena.runtime_history j where j.ns=g.ns and j.kind='chat-job' and j.payload->>'groupId'=g.id and j.status in ('queued','claimed','running','uncertain')))`, [namespace()])).map(r => String(r.id))
        : await readGroupIds();
      for (const id of ids) void pumpGroqGroup(id).catch(() => console.warn("Arena Groq group will reconcile pending work"));
      state.lastSuccessfulPollAt = Date.now();
      if (usingPostgres() && Date.now() - lastCleanup > 3600_000) { lastCleanup = Date.now(); await cleanupSqlRuntime(); }
    }
    catch { console.warn("Arena Groq scheduler temporarily unavailable"); }
    finally { busy = false; }
  };
  // Self-hosted Node worker; no GPU, paid worker service or browser lifetime dependency.
  const timer = setInterval(() => void tick(), 5000); timer.unref();
  void tick();
}
export function wakeGroqGroup(id: string) {
  if (!groqRunnerState()) return;
  const timer = setTimeout(() => void pumpGroqGroup(id).catch(() => console.warn("Arena Groq group will reconcile pending work")), 0);
  timer.unref();
}
