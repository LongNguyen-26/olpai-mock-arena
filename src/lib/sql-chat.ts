import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { namespace, query, sqlTransaction, sqlNow } from "./sql";
import { ApiError } from "./api-error";
import { rateLimit } from "./auth";
import { applyPrivateTransition } from "./domain";
import { chatbotOpen, emptySession, outputBudget, ChatLimitError, type ChatSession } from "./workspace-domain";
import { chatPolicyView, contestantSession, conversationTitle } from "./chat-conversation";
import type { ChatGroup } from "./chat-groups";
import type { ChatJob, WorkerRequest, Target } from "./chat-queue";
import type { Contest, SafeUser } from "./types";
import type { groqComplete } from "./groq";

export type SqlChatJob = ChatJob & { apiRetries?: number; apiResult?: Awaited<ReturnType<typeof groqComplete>> };
const active = ["queued", "claimed", "running", "uncertain"];
const terminal = (j: ChatJob) => !active.includes(j.status);
const policyError = "Chatbot đã khóa hoặc quyền truy cập đã thay đổi.";
export function sqlSessionId(k: string) {
  const marker = ":gpu:chat-group:", position = k.indexOf(marker);
  if (position < 0) throw new Error("Invalid Groq conversation identity");
  return k.slice(position + marker.length);
}
export async function sqlChatContext(k: string): Promise<ChatSession | null> {
  return (await query("select payload from arena.runtime_history where ns=$1 and kind='chat-group-session' and id=$2", [namespace(), sqlSessionId(k)]))[0]?.payload ?? null;
}
export async function sqlChatJob(id: string): Promise<SqlChatJob | null> {
  return (await query("select payload from arena.runtime_history where ns=$1 and kind='chat-job' and id=$2 and (expires_at is null or expires_at>floor(extract(epoch from clock_timestamp())*1000))", [namespace(), id]))[0]?.payload ?? null;
}
export async function putSqlHistory(client: PoolClient, kind: string, id: string, payload: Record<string, unknown>, now: number) {
  const conversation = payload.conversation as ChatSession["conversation"];
  await client.query(`insert into arena.runtime_history(ns,kind,id,round_id,run_id,owner_id,status,payload,expires_at,observed_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(ns,kind,id) do update set
    round_id=excluded.round_id,run_id=excluded.run_id,owner_id=excluded.owner_id,status=excluded.status,payload=excluded.payload,expires_at=excluded.expires_at,observed_at=excluded.observed_at`,
    [namespace(), kind, id, conversation?.roundId ?? payload.roundId ?? null, conversation?.runId ?? payload.runId ?? null,
      payload.ownerId ?? null, payload.status ?? null, JSON.stringify(payload), kind === "chat-job" ? now + 30 * 86400_000 : null, now]);
}
async function saveSession(client: PoolClient, job: ChatJob, s: ChatSession, now: number) {
  if (s.conversation) s.conversation.updatedAt = now;
  await putSqlHistory(client, "chat-group-session", sqlSessionId(job.sessionKey), s as unknown as Record<string, unknown>, now);
}
async function saveJob(client: PoolClient, j: SqlChatJob, now: number) {
  j.updatedAt = now;
  await putSqlHistory(client, "chat-job", j.id, j as unknown as Record<string, unknown>, now);
}
async function session(client: PoolClient, j: ChatJob): Promise<ChatSession> {
  return (await client.query("select payload from arena.runtime_history where ns=$1 and kind='chat-group-session' and id=$2", [namespace(), sqlSessionId(j.sessionKey)])).rows[0]?.payload ?? emptySession();
}
async function group(client: PoolClient, id: string): Promise<ChatGroup> {
  const g = (await client.query("select payload from arena.runtime_history where ns=$1 and kind='chat-group' and id=$2", [namespace(), id])).rows[0]?.payload as ChatGroup | undefined;
  if (!g || g.provider !== "groq" || !g.groq) throw new ApiError("Không tìm thấy Chatbot Groq.", 404);
  return g;
}
async function contest(client: PoolClient, g: ChatGroup, now: number): Promise<Contest> {
  const c = (await client.query("select configuration from arena.rounds where ns=$1 and id=$2", [namespace(), g.roundId])).rows[0]?.configuration;
  if (!c) throw new ApiError("Không tìm thấy vòng luyện.", 404);
  return applyPrivateTransition(c, now);
}
async function valid(client: PoolClient, j: ChatJob, g: ChatGroup, c: Contest, now: number) {
  if (g.retired || c.id !== j.runId || (j.chatEpoch ?? 0) !== (c.chatEpoch ?? 0) ||
      (j.accessDeadline != null && now >= j.accessDeadline) || !chatbotOpen({ runId: j.runId, services: "llm" }, c, now)) return false;
  const result = await client.query(`select case when $3::boolean then exists(select 1 from arena.admins where ns=$1 and user_id=$2)
    else exists(select 1 from arena.users u join arena.team_members m on m.ns=u.ns and m.user_id=u.id and m.team_id=u.team_id
      where u.ns=$1 and u.id=$2 and u.deleted_at is null and u.team_id=$4)
      and ($5::text<>'team' or exists(select 1 from arena.registrations where ns=$1 and round_id=$6 and user_id=$2 and status='approved')) end as allowed`,
    [namespace(), j.userId, j.admin, j.teamId, j.scope, g.roundId]);
  return !!result.rows[0].allowed;
}
async function ownerReady(client: PoolClient, g: ChatGroup) {
  return !!(await client.query("select 1 from arena.admins a join arena.api_credentials c on c.ns=a.ns and c.owner_id=a.user_id and c.provider='groq' where a.ns=$1 and a.user_id=$2", [namespace(), g.ownerId])).rowCount;
}
async function groupTransaction<T>(id: string, fn: (client: PoolClient, g: ChatGroup, c: Contest, now: number) => Promise<T>) {
  return sqlTransaction(async client => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${namespace()}:groq-group:${id}`]);
    const g = await group(client, id), now = await sqlNow(client), c = await contest(client, g, now);
    return fn(client, g, c, now);
  }, "runtime");
}
async function jobs(client: PoolClient, id: string, run?: string): Promise<SqlChatJob[]> {
  return (await client.query(`select payload from arena.runtime_history where ns=$1 and kind='chat-job'
    and payload->>'groupId'=$2 and ($3::text is null or run_id=$3) and status=any($4::text[])
    and (expires_at is null or expires_at>floor(extract(epoch from clock_timestamp())*1000)) order by observed_at,id`, [namespace(), id, run ?? null, active])).rows.map(r => r.payload);
}
async function finish(client: PoolClient, j: SqlChatJob, status: "completed" | "failed" | "cancelled", now: number, error?: string, result?: Awaited<ReturnType<typeof groqComplete>>) {
  if (terminal(j)) return;
  const s = await session(client, j);
  if (s.pending?.requestId === j.id) {
    if (result) {
      s.messages.push({ role: "assistant", content: result.content });
      s.inputTokens += result.inputTokens - (j.promptTokens ?? 0);
      s.outputTokens += result.outputTokens - (j.maxTokens ?? 0);
      s.lastTurn = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
      delete s.error;
    } else { s.error = error; if (s.messages.length) s.messages[s.messages.length - 1].rejected = true; }
    delete s.pending; s.lastRequestId = j.id;
    await saveSession(client, j, s, now);
  }
  j.status = status; j.error = error;
  if (result) Object.assign(j, { providerRequestId: result.providerRequestId, actualInputTokens: result.inputTokens, actualOutputTokens: result.outputTokens });
  await saveJob(client, j, now);
}
async function reconcile(client: PoolClient, g: ChatGroup, c: Contest, now: number, list: SqlChatJob[]) {
  for (const j of list) {
    if (!await valid(client, j, g, c, now)) { await finish(client, j, "cancelled", now, policyError); continue; }
    if ((j.status === "claimed" || j.status === "running") && now > (j.leaseUntil ?? 0)) {
      if (j.status === "claimed") { j.status = "queued"; delete j.workerId; delete j.slot; delete j.attempt; }
      else { j.status = "uncertain"; j.error = "Chưa xác nhận được kết quả. Vui lòng liên hệ admin.";
        const s = await session(client, j); s.error = j.error; await saveSession(client, j, s, now); }
      await saveJob(client, j, now);
    }
  }
}
export async function sqlChatSummary(id: string, run: string) {
  return groupTransaction(id, async (client, g, c, now) => {
    const list = await jobs(client, id, run); await reconcile(client, g, c, now, list);
    return { queued: list.filter(j => j.status === "queued").length,
      running: list.filter(j => j.status === "claimed" || j.status === "running").length,
      oldestQueuedAt: Math.min(...list.filter(j => j.status === "queued").map(j => j.createdAt), Infinity) === Infinity ? null : Math.min(...list.filter(j => j.status === "queued").map(j => j.createdAt)),
      uncertain: list.filter(j => j.status === "uncertain").map(j => ({ id: j.id, workerId: j.workerId, createdAt: j.createdAt })) };
  });
}
export async function sqlEnqueueChat(t: Target, user: SafeUser, sessionId: string, requestId: string, content: string, expectedRunId?: string) {
  const fingerprint = createHash("sha256").update(JSON.stringify([t.id, t.c.id, user.id, sessionId, content])).digest("hex");
  await rateLimit(`gpu:chat:${user.id}`, 20, 60);
  return groupTransaction(t.groupId!, async (client, g, c, now) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${namespace()}:chat-request:${requestId}`]);
    if (c.id !== t.c.id) throw new ApiError("Vòng luyện vừa thay đổi. Hãy tải lại trước khi gửi.", 409);
    if (expectedRunId && expectedRunId !== c.id) throw new ApiError("Vòng luyện vừa thay đổi. Hãy tải lại trước khi gửi.", 409);
    const old = await sqlChatJob(requestId);
    if (old) {
      if (old.fingerprint !== fingerprint) throw new ApiError("Mã request đã được sử dụng cho nội dung khác.", 409);
      const s = await session(client, old);
      return { requestId, session: user.admin ? s : contestantSession(s), template: user.admin ? g.template : chatPolicyView(g.template) };
    }
    if (g.paused || g.retired || !await ownerReady(client, g)) throw new ApiError("Chatbot tạm ngừng nhận tin nhắn mới.", 409);
    const audience = user.admin ? `admin-${user.id}` : `team-${user.teamId}`;
    const j: SqlChatJob = { id: requestId, fingerprint, target: t.id, groupId: g.id, roundId: g.roundId, runId: c.id,
      userId: user.id, teamId: user.teamId, admin: user.admin, audience, scope: g.scope, sessionId,
      sessionKey: `${namespace()}:gpu:chat-group:${g.id}:${c.id}:${audience}:${sessionId}`,
      counterKey: "", queueKey: "", activeKey: "", roundKey: "", registrationKey: "", content,
      status: "queued", chatEpoch: c.chatEpoch ?? 0, accessDeadline: c.chatbotUntil ?? null, createdAt: now, updatedAt: now };
    if (!await valid(client, j, g, c, now)) throw new ApiError(policyError, 403);
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${namespace()}:chat-audience:${c.id}:${audience}`]);
    const pending = Number((await client.query(`select count(*) as n from arena.runtime_history where ns=$1 and kind='chat-job' and run_id=$2 and payload->>'audience'=$3 and status=any($4::text[]) and (expires_at is null or expires_at>$5)`, [namespace(), c.id, audience, active, now])).rows[0].n);
    if (pending >= 4) throw new ApiError("Đội đã có 4 prompt chưa hoàn tất. Hãy gửi lại sau.", 409);
    const s = await session(client, j);
    if (s.pending) throw new ApiError("Phiên này đã có một prompt chưa hoàn tất.", 409);
    if (s.exhausted || s.inputTokens + s.outputTokens >= g.template.sessionTokenLimit) throw new ApiError("Phiên đã hết ngân sách token. Dùng /new để tạo phiên mới.", 409);
    s.conversation ??= { sessionId, roundId: g.roundId, runId: c.id, target: t.id, audience, teamId: user.teamId, createdAt: now, updatedAt: now, title: conversationTitle(content) };
    s.conversation.policy = chatPolicyView(g.template);
    s.messages.push({ role: "user", content }); s.pending = { requestId, reserved: 0 }; delete s.error; delete s.limitNotice;
    await saveSession(client, j, s, now); await saveJob(client, j, now);
    await client.query("insert into arena.chat_lanes(ns,group_id,run_id,audience) values($1,$2,$3,$4) on conflict do nothing", [namespace(), g.id, c.id, audience]);
    return { requestId, session: user.admin ? s : contestantSession(s), template: user.admin ? g.template : chatPolicyView(g.template) };
  });
}
export async function sqlGroqAction(action: string, v: WorkerRequest, id: string) {
  return groupTransaction(id, async (client, g, c, now) => {
    const open = !g.retired && chatbotOpen({ runId: c.id, services: "llm" }, c, now);
    if (!g.groq || !await ownerReady(client, g)) throw new ApiError("Dịch vụ Chatbot chưa sẵn sàng.", 409);
    if (v.protocol !== 2 || v.capacity !== g.groq.parallel || !Number.isInteger(v.slot) || v.slot! < 0 || v.slot! >= g.groq.parallel)
      throw new ApiError("Số slot worker không khớp cấu hình.", 409);
    const list = await jobs(client, id); await reconcile(client, g, c, now, list);
    if (action === "claim") {
      if (!open || g.paused || !v.ready || !v.fingerprint || list.some(j => ["claimed", "running", "uncertain"].includes(j.status) && j.slot === v.slot)) return { job: null, open, runId: c.id };
      const lanes = (await client.query("select audience from arena.chat_lanes where ns=$1 and group_id=$2 and run_id=$3 order by served_at,audience", [namespace(), id, c.id])).rows.map(r => r.audience as string);
      const queued = list.filter(j => j.status === "queued").sort((a,b) => a.createdAt-b.createdAt || a.id.localeCompare(b.id));
      const lane = lanes.find(a => queued.some(j => j.audience === a)) ?? queued[0]?.audience;
      const j = queued.find(j => j.audience === lane); if (!j) return { job: null, open, runId: c.id };
      j.status = "claimed"; j.workerId = `groq:${id}`; j.slot = v.slot; j.attempt = randomUUID(); j.leaseUntil = now + 45000;
      await saveJob(client, j, now);
      await client.query(`insert into arena.chat_lanes(ns,group_id,run_id,audience,served_at) values($1,$2,$3,$4,$5)
        on conflict(ns,group_id,run_id,audience) do update set served_at=greatest(excluded.served_at,arena.chat_lanes.served_at+1)`, [namespace(), id, c.id, j.audience, now]);
      const s = await session(client, j);
      return { job: { requestId: j.id, attempt: j.attempt, slot: j.slot, runId: c.id, messages: s.messages.filter(m => !m.rejected), template: g.template, contextWindowTokens: g.contextWindowTokens, inputTokens: s.inputTokens, outputTokens: s.outputTokens }, open, runId: c.id };
    }
    const j = v.requestId ? await sqlChatJob(v.requestId) : null;
    if (!j || j.groupId !== id || j.workerId !== `groq:${id}` || j.slot !== v.slot || j.attempt !== v.attempt) throw new ApiError("Request không thuộc worker này.", 409);
    if (terminal(j)) return { accepted: j.status === "completed", terminal: true, open, runId: c.id };
    if (!await valid(client, j, g, c, now)) { await finish(client, j, "cancelled", now, policyError); return { accepted: false, terminal: true, open: false, runId: c.id }; }
    if (action === "heartbeat") { j.leaseUntil = now + 45000; await saveJob(client, j, now); return { accepted: true, open, runId: c.id }; }
    const s = await session(client, j);
    if (action === "prepare") {
      // Repeated prepare never authorizes sending the same inference twice.
      if (j.status !== "claimed" || now > (j.leaseUntil ?? 0)) return { execute: false, terminal: terminal(j) };
      let max: number;
      try { max = Math.min(outputBudget(g.template, s, v.promptTokens!), g.contextWindowTokens - 128 - v.promptTokens!); if (max < 1) throw new ChatLimitError("input", "Prompt vượt cửa sổ context."); }
      catch (error) { if (!(error instanceof ChatLimitError)) throw error; await finish(client, j, "failed", now, error.message); return { execute: false, terminal: true }; }
      if (s.pending?.requestId !== j.id) return { execute: false, terminal: true };
      j.status = "running"; j.promptTokens = v.promptTokens; j.maxTokens = max; j.leaseUntil = now + 45000;
      s.inputTokens += j.promptTokens!; s.outputTokens += max; s.pending.reserved = j.promptTokens! + max;
      if (s.conversation) s.conversation.policy = chatPolicyView(g.template);
      await saveSession(client, j, s, now); await saveJob(client, j, now);
      return { execute: true, maxTokens: max, inputTokens: j.promptTokens };
    }
    if (action === "persist-result") { if (!["running", "uncertain"].includes(j.status)) return { accepted: false };
      j.apiResult = { content: v.content!, inputTokens: v.inputTokens!, outputTokens: v.outputTokens!, providerRequestId: v.providerRequestId }; await saveJob(client, j, now); return { accepted: true }; }
    if (action === "complete") {
      if (!["running", "uncertain"].includes(j.status) || !Number.isInteger(v.inputTokens) || v.inputTokens! < 1 || !Number.isInteger(v.outputTokens) || v.outputTokens! < 0 || v.outputTokens! > j.maxTokens! || typeof v.content !== "string") throw new ApiError("Kết quả worker không hợp lệ.", 422);
      await finish(client, j, "completed", now, undefined, { content: v.content, inputTokens: v.inputTokens!, outputTokens: v.outputTokens!, providerRequestId: v.providerRequestId });
      return { accepted: true, terminal: true, open, runId: c.id };
    }
    if (["api-requeue", "api-rejected", "api-uncertain"].includes(action)) {
      if (!["claimed", "running"].includes(j.status)) return { accepted: false, terminal: true };
      const message = v.safeError ?? "Groq chưa xác nhận kết quả.";
      if (action === "api-uncertain") { j.status = "uncertain"; j.error = message; s.error = message; }
      else {
        if (j.status === "running" && s.pending?.requestId === j.id) { s.inputTokens -= j.promptTokens!; s.outputTokens -= j.maxTokens!; s.pending.reserved = 0; }
        if (action === "api-requeue" && (j.apiRetries = (j.apiRetries ?? 0) + 1) < 3) {
          j.status = "queued"; delete j.workerId; delete j.slot; delete j.attempt; delete j.promptTokens; delete j.maxTokens;
        } else { await saveSession(client, j, s, now); await finish(client, j, "failed", now, message); return { accepted: true, terminal: true, open, runId: c.id }; }
      }
      await saveSession(client, j, s, now); await saveJob(client, j, now);
      return { accepted: true, terminal: action !== "api-requeue", open, runId: c.id };
    }
    throw new ApiError("Không tìm thấy thao tác worker.", 404);
  });
}
export async function sqlSettleUncertain(user: SafeUser, j: SqlChatJob) {
  return groupTransaction(j.groupId!, async (client, g, _c, now) => {
    if (!user.admin || g.ownerId !== user.id) throw new ApiError("Request thuộc quản trị viên khác.", 403);
    const current = await sqlChatJob(j.id);
    if (current?.status === "uncertain") await finish(client, current, "failed", now, "Lượt này không xác nhận được kết quả. Ngân sách đã giữ được giữ nguyên; hãy tạo đoạn chat mới.");
    return 1;
  });
}
export async function sqlActiveGroqJobs(id: string) {
  return sqlTransaction(client => jobs(client, id));
}
