import { createHash, randomUUID } from "node:crypto";
import { db, key, serverNow } from "./db";
import { ApiError, rateLimit } from "./auth";
import { getContest, roundKey, registrationKey } from "./rounds";
import {
  chatbotOpen,
  chatContextWindow,
  emptySession,
  outputBudget,
  ChatLimitError,
  type ChatSession,
  type WorkspaceTemplate,
} from "./workspace-domain";
import { accessWorkspace, getWorkspace, withChatPolicy } from "./workspaces";
import { accessChatGroup, getChatGroup, groupTemplate } from "./chat-groups";
import { decryptSecret, matchesSecret } from "./workspace-crypto";
import { hasService } from "./workspace-options";
import type { Contest, SafeUser, User } from "./types";

export const QUEUE_PROTOCOL = 1;
export const LEASE_MS = 45000;
const TTL = 30 * 86400;
export const jobKey = (id: string) => key(`gpu:job:${id}`);
export const workerKey = (id: string) => key(`gpu:worker:${id}`);
export const activeJobsKey = (target: string, run: string) =>
  key(`gpu:jobs:${target}:${run}`);
type Status =
  | "queued"
  | "claimed"
  | "running"
  | "uncertain"
  | "completed"
  | "failed"
  | "cancelled";
export interface ChatJob {
  id: string;
  fingerprint: string;
  target: string;
  groupId?: string;
  workspaceId?: string;
  roundId: string;
  runId: string;
  userId: string;
  teamId: string | null;
  admin: boolean;
  audience: string;
  scope: "team" | "all";
  sessionId: string;
  sessionKey: string;
  counterKey: string;
  queueKey: string;
  activeKey: string;
  roundKey: string;
  registrationKey: string;
  content: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
  workerId?: string;
  attempt?: string;
  leaseUntil?: number;
  promptTokens?: number;
  maxTokens?: number;
  error?: string;
}
export interface ChatWorker {
  workspaceId: string;
  runId: string;
  ready: boolean;
  protocol: number;
  fingerprint: string;
  heartbeatAt: number;
  jobId?: string;
  draining?: boolean;
}
interface Target {
  id: string;
  groupId?: string;
  workspaceId?: string;
  roundId: string;
  ownerId: string;
  scope: "team" | "all";
  teamId: string | null;
  teamName: string;
  roundTitle: string;
  template: WorkspaceTemplate;
  contextWindowTokens: number;
  c: Contest;
  paused: boolean;
  workerIds: string[];
}

// Every transition fences the round, worker attempt and session. No prompt or credential is logged.
const LUA = `
local p=ARGV[1]; local now=tonumber(ARGV[2]); local ttl=tonumber(ARGV[3]);
local function read(k) local v=redis.call('GET',k);if v then return cjson.decode(v) end end
local function write(k,v) redis.call('SET',k,cjson.encode(v),'EX',ttl) end
local function valid(j)
 local c=read(j.roundKey);if not c or c.id~=j.runId or c.hidden or c.deletedAt then return false end
 if c.startAt==cjson.null or not c.startAt or now<c.startAt then return false end
 if c.forcedEndAt and c.forcedEndAt~=cjson.null and now>=c.forcedEndAt then return false end
 local cutoff=c.privateAt;if not cutoff or cutoff==cjson.null then if not c.unlimited then cutoff=c.startAt+c.publicSeconds*1000 end end
 if cutoff and cutoff~=cjson.null and now>=cutoff then return false end
 if j.admin then return redis.call('GET',p..':admin')==j.userId or redis.call('SISMEMBER',p..':admins',j.userId)==1 end
 local u=read(p..':user:'..j.userId);if not u or u.teamId~=j.teamId then return false end
 local raw=redis.call('HGET',p..':teams',j.teamId);if not raw then return false end
 local found=false;for _,id in ipairs(cjson.decode(raw).members) do if id==j.userId then found=true end end
 if not found then return false end
 if j.scope=='team' then local r=redis.call('HGET',j.registrationKey,j.userId);if not r or cjson.decode(r).status~='approved' then return false end end
 return true
end
local function enqueue(j)
 local q=read(j.queueKey) or {order={},lanes={}};local lane=q.lanes[j.audience];
 if not lane or #lane==0 then lane={};table.insert(q.order,j.audience) end
 table.insert(lane,j.id);q.lanes[j.audience]=lane;write(j.queueKey,q)
end
local function finish(j,status,message,output)
 if j.status=='completed' or j.status=='failed' or j.status=='cancelled' then return end
 local s=read(j.sessionKey);if s and s.pending and s.pending.requestId==j.id then
  if status=='completed' then
   table.insert(s.messages,{role='assistant',content=output.content});s.outputTokens=s.outputTokens-(j.maxTokens-output.outputTokens)
   s.lastTurn={inputTokens=j.promptTokens,outputTokens=output.outputTokens};s.error=nil
  else
   s.error=message; if #s.messages>0 then s.messages[#s.messages].rejected=true end
  end
  s.pending=nil;s.lastRequestId=j.id;write(j.sessionKey,s)
 end
 j.status=status;j.error=message;j.updatedAt=now;write(p..':gpu:job:'..j.id,j)
 if tonumber(redis.call('GET',j.counterKey) or '0')>0 then redis.call('DECR',j.counterKey) end
 redis.call('ZREM',j.activeKey,j.id)
end
`;
async function script<T>(body: string, keys: string[], args: unknown[] = []) {
  return db().eval<unknown[], T>(LUA + body, keys, [
    process.env.ARENA_NAMESPACE ?? "arena:v1",
    await serverNow(),
    TTL,
    ...args,
  ]);
}

export async function resolveChatTarget(
  user: SafeUser,
  id?: string,
  groupId?: string,
): Promise<Target> {
  if (!!id === !!groupId) throw new ApiError("Chọn một Chatbot.");
  if (groupId) {
    const { group: g, c } = await accessChatGroup(user, groupId);
    return {
      id: `group:${g.id}`,
      groupId,
      roundId: g.roundId,
      ownerId: g.ownerId,
      scope: g.scope,
      teamId: g.teamId,
      teamName: g.name,
      roundTitle: c.title,
      template: await groupTemplate(g),
      contextWindowTokens: g.contextWindowTokens,
      c,
      paused: g.paused,
      workerIds: g.workspaceIds,
    };
  }
  const { w, c } = await accessWorkspace(user, id!);
  if (!hasService(w, "llm"))
    throw new ApiError("Pod này không cung cấp Chatbot.", 409);
  if (w.chatGroupId) return resolveChatTarget(user, undefined, w.chatGroupId);
  return {
    id: `workspace:${w.id}`,
    workspaceId: w.id,
    roundId: w.roundId,
    ownerId: w.ownerId,
    scope: w.scope ?? "team",
    teamId: w.teamId,
    teamName: w.teamName,
    roundTitle: c.title,
    template: w.template,
    contextWindowTokens: w.contextWindowTokens ?? chatContextWindow(w.template),
    c,
    paused: false,
    workerIds: [w.id],
  };
}
function sessionStore(t: Target, user: SafeUser, session: string) {
  const audience = user.admin ? `admin-${user.id}` : `team-${user.teamId}`;
  return t.groupId
    ? key(`gpu:chat-group:${t.groupId}:${t.c.id}:${audience}:${session}`)
    : key(
        `gpu:chat:${t.workspaceId}:${t.c.id}${t.scope === "all" ? `:${audience}` : ""}:${session}`,
      );
}
export async function chatWorkers(ids: string[]) {
  return ids.length
    ? (await db().mget<(ChatWorker | null)[]>(...ids.map(workerKey))).filter(
        (w): w is ChatWorker => !!w,
      )
    : [];
}
export async function reconcileChat(target: string, run: string) {
  const ids = await db().zrange<string[]>(activeJobsKey(target, run), 0, 255);
  if (!ids.length) return;
  const workerIds = target.startsWith("group:")
    ? (await getChatGroup(target.slice(6))).workspaceIds
    : [target.slice(10)];
  const workers = await chatWorkers(workerIds),
    now = await serverNow(),
    unavailableKey = key(`gpu:unavailable:${target}:${run}`);
  const available = workers.some(
    (w) => w.ready && w.runId === run && now - w.heartbeatAt < LEASE_MS,
  );
  let outage = false;
  if (available) await db().del(unavailableKey);
  else {
    await db().set(unavailableKey, now, { nx: true, ex: TTL });
    outage = now - Number(await db().get<number>(unavailableKey)) >= 180000;
  }
  await Promise.all(
    ids.map((id) =>
      script(
        `
 local j=read(KEYS[1]);if not j then redis.call('ZREM',KEYS[2],ARGV[4]);return 0 end
 if not valid(j) then finish(j,'cancelled','Chatbot đã khóa hoặc quyền truy cập đã thay đổi.');return 1 end
 if j.status=='queued' and ARGV[5]=='1' then finish(j,'failed','Chatbot chưa thể hoàn tất phản hồi. Vui lòng gửi lại sau hoặc liên hệ admin.');return 1 end
 if (j.status=='running' or j.status=='claimed') and now>(j.leaseUntil or 0) then
  if j.status=='claimed' then j.status='queued';j.workerId=nil;j.attempt=nil;enqueue(j)
  else j.status='uncertain';j.error='Chưa xác nhận được kết quả. Vui lòng liên hệ admin.';local s=read(j.sessionKey);if s and s.pending and s.pending.requestId==j.id then s.error=j.error;write(j.sessionKey,s) end end
  j.updatedAt=now;write(KEYS[1],j)
 end;return 1`,
        [jobKey(id), activeJobsKey(target, run)],
        [id, outage ? "1" : "0"],
      ),
    ),
  );
}
export async function readQueuedChat(
  user: SafeUser,
  id: string | undefined,
  sessionId: string,
  groupId?: string,
) {
  const t = await resolveChatTarget(user, id, groupId);
  await reconcileChat(t.id, t.c.id);
  let [session, workers, now] = await Promise.all([
    db().get<ChatSession>(sessionStore(t, user, sessionId)),
    chatWorkers(t.workerIds),
    serverNow(),
  ]);
  if (
    session?.pending &&
    !(await db().exists(jobKey(session.pending.requestId)))
  ) {
    session = await script<ChatSession>(
      `local s=read(KEYS[1]);if s and s.pending and s.pending.requestId==ARGV[4] then s.pending=nil;s.error='Lượt cũ chưa xác nhận được kết quả; ngân sách đã giữ được giữ nguyên. Bạn có thể tạo đoạn chat mới.';write(KEYS[1],s) end;return cjson.encode(s)`,
      [sessionStore(t, user, sessionId)],
      [session.pending.requestId],
    );
  }
  const policyOpen = chatbotOpen({ runId: t.c.id, services: "llm" }, t.c, now);
  return {
    session: session ?? emptySession(),
    template: t.template,
    contextWindowTokens: t.contextWindowTokens,
    enabled:
      policyOpen &&
      !t.paused &&
      workers.some(
        (w) =>
          w.ready &&
          w.protocol === QUEUE_PROTOCOL &&
          w.runId === t.c.id &&
          now - w.heartbeatAt < LEASE_MS &&
          !w.draining,
      ),
    policyOpen,
    runId: t.c.id,
    serverNow: now,
    teamName: t.teamName,
    roundTitle: t.roundTitle,
    statusMessage: "",
  };
}
export async function enqueueChat(
  user: SafeUser,
  id: string | undefined,
  sessionId: string,
  requestId: string,
  content: string,
  groupId?: string,
  expectedRunId?: string,
) {
  const t = await resolveChatTarget(user, id, groupId),
    now = await serverNow();
  if (expectedRunId && expectedRunId !== t.c.id)
    throw new ApiError(
      "Vòng luyện vừa thay đổi. Hãy tải lại trước khi gửi.",
      409,
    );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([t.id, t.c.id, user.id, sessionId, content]))
    .digest("hex");
  const old = await db().get<ChatJob>(jobKey(requestId));
  if (old) {
    if (old.fingerprint !== fingerprint)
      throw new ApiError("Mã request đã được sử dụng cho nội dung khác.", 409);
    return {
      requestId,
      session: (await db().get<ChatSession>(old.sessionKey)) ?? emptySession(),
      template: t.template,
    };
  }
  await rateLimit(`gpu:chat:${user.id}`, 20, 60);
  await reconcileChat(t.id, t.c.id);
  if (t.paused) throw new ApiError("Chatbot tạm ngừng nhận tin nhắn mới.", 409);
  if (!chatbotOpen({ runId: t.c.id, services: "llm" }, t.c, now))
    throw new ApiError("Chatbot chỉ mở trong public của lượt thi.", 403);
  const audience = user.admin ? `admin-${user.id}` : `team-${user.teamId}`;
  const j: ChatJob = {
    id: requestId,
    fingerprint,
    target: t.id,
    groupId: t.groupId,
    workspaceId: t.workspaceId,
    roundId: t.roundId,
    runId: t.c.id,
    userId: user.id,
    teamId: user.teamId,
    admin: user.admin,
    audience,
    scope: t.scope,
    sessionId,
    sessionKey: sessionStore(t, user, sessionId),
    counterKey: key(`gpu:pending:${t.c.id}:${audience}`),
    queueKey: key(`gpu:queue:${t.id}:${t.c.id}`),
    activeKey: activeJobsKey(t.id, t.c.id),
    roundKey: roundKey(t.c),
    registrationKey: registrationKey(t.c),
    content,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  const result = await script<string>(
    `
 local j=cjson.decode(ARGV[4]);local old=read(KEYS[1]);if old then if old.fingerprint~=j.fingerprint then return 'duplicate' end;return 'ok' end
 if j.groupId then local g=read(p..':gpu:chat-group:'..j.groupId);if not g or g.paused or g.retired then return 'policy' end end
 if not valid(j) then return 'policy' end
 local s=read(j.sessionKey) or {messages={},inputTokens=0,outputTokens=0}
 if s.pending then return 'session' end
 if s.exhausted or s.inputTokens+s.outputTokens>=tonumber(ARGV[5]) then return 'tokens' end
 if tonumber(redis.call('GET',j.counterKey) or '0')>=4 then return 'team' end
 table.insert(s.messages,{role='user',content=j.content});s.pending={requestId=j.id,reserved=0};s.error=nil;s.limitNotice=nil
 write(j.sessionKey,s);write(KEYS[1],j);redis.call('INCR',j.counterKey);redis.call('EXPIRE',j.counterKey,ttl)
 redis.call('ZADD',j.activeKey,now,j.id);redis.call('EXPIRE',j.activeKey,ttl);enqueue(j);return 'ok'`,
    [jobKey(requestId)],
    [JSON.stringify(j), t.template.sessionTokenLimit],
  );
  const errors: Record<string, string> = {
    duplicate: "Mã request đã được sử dụng.",
    policy: "Chatbot đã khóa hoặc quyền truy cập đã thay đổi.",
    session: "Phiên này đã có một prompt chưa hoàn tất.",
    team: "Đội đã có 4 prompt chưa hoàn tất. Hãy gửi lại sau.",
    tokens: "Phiên đã hết ngân sách token. Dùng /new để tạo phiên mới.",
  };
  if (result !== "ok")
    throw new ApiError(errors[result] ?? "Không thể gửi tin nhắn.", 409);
  return {
    requestId,
    session: (await db().get<ChatSession>(j.sessionKey))!,
    template: t.template,
  };
}

async function authenticatedWorker(id: string, authorization: string | null) {
  const w = await getWorkspace(id);
  if (!matchesSecret(authorization, decryptSecret(w.secret)))
    throw new ApiError("Không có quyền truy cập.", 401);
  if (
    !hasService(w, "llm") ||
    ["terminated", "failed", "stopped"].includes(w.status)
  )
    throw new ApiError("Worker không hoạt động.", 403);
  const c = await getContest(w.roundId);
  const g = w.chatGroupId ? await getChatGroup(w.chatGroupId) : undefined;
  if (g && (g.ownerId !== w.ownerId || !g.workspaceIds.includes(w.id)))
    throw new ApiError("Worker không thuộc nhóm.", 403);
  if (
    g &&
    (g.retired ||
      g.template.imageName !== w.template.imageName ||
      g.contextWindowTokens !== w.contextWindowTokens)
  )
    throw new ApiError("Runtime worker không khớp nhóm.", 409);
  return {
    w,
    c,
    g,
    target: g ? `group:${g.id}` : `workspace:${w.id}`,
    template: g ? await groupTemplate(g) : (await withChatPolicy(w)).template,
    context:
      g?.contextWindowTokens ??
      w.contextWindowTokens ??
      chatContextWindow(w.template),
  };
}
export interface WorkerRequest {
  workspaceId: string;
  protocol: number;
  ready: boolean;
  fingerprint: string;
  requestId?: string;
  attempt?: string;
  promptTokens?: number;
  content?: string;
  inputTokens?: number;
  outputTokens?: number;
}
export async function workerAction(
  action: string,
  v: WorkerRequest,
  authorization: string | null,
) {
  const { w, c, g, target, template, context } = await authenticatedWorker(
    v.workspaceId,
    authorization,
  );
  const now = await serverNow(),
    open = chatbotOpen({ runId: c.id, services: "llm" }, c, now);
  if (v.protocol !== QUEUE_PROTOCOL)
    throw new ApiError("Giao thức worker không tương thích.", 409);
  if (g && v.fingerprint) {
    const matches = await db().eval(
      "local raw=redis.call('GET',KEYS[1]);if not raw then return 0 end;local g=cjson.decode(raw);if g.modelFingerprint and g.modelFingerprint~=ARGV[1] then return 0 end;g.modelFingerprint=ARGV[1];redis.call('SET',KEYS[1],cjson.encode(g));return 1",
      [key(`gpu:chat-group:${g.id}`)],
      [v.fingerprint],
    );
    if (!matches) throw new ApiError("Model worker không khớp nhóm.", 409);
  }
  await reconcileChat(target, c.id);
  const draining = !!(await db().get<boolean>(key(`gpu:drain:${w.id}`)));
  // Updating liveness never clears a reserved slot; only a terminal job or a fenced claim does.
  const worker = await script<ChatWorker>(
    `
 local old=read(KEYS[1]) or {};local next=cjson.decode(ARGV[4]);next.jobId=old.jobId;write(KEYS[1],next);return cjson.encode(next)`,
    [workerKey(w.id)],
    [
      JSON.stringify({
        workspaceId: w.id,
        runId: c.id,
        ready: v.ready && open,
        protocol: v.protocol,
        fingerprint: v.fingerprint,
        heartbeatAt: now,
        draining,
      }),
    ],
  );
  if (action === "claim") {
    if (!open || !v.ready || draining || !v.fingerprint)
      return { job: null, open, runId: c.id };
    const job = await script<ChatJob | null>(
      `
 local worker=read(KEYS[1]);if worker.jobId then local busy=read(p..':gpu:job:'..worker.jobId);if busy and (busy.status=='claimed' or busy.status=='running' or busy.status=='uncertain') and busy.workerId==ARGV[4] then return nil end end
 if redis.call('GET',p..':gpu:drain:'..ARGV[4])=='true' then return nil end
 local q=read(KEYS[2]);if not q then return nil end
 while #q.order>0 do
  local team=table.remove(q.order,1);local lane=q.lanes[team];local id=table.remove(lane,1)
  if #lane>0 then table.insert(q.order,team) else q.lanes[team]=nil end
  local j=read(p..':gpu:job:'..id)
  if j and j.status=='queued' then
   if valid(j) then j.status='claimed';j.workerId=ARGV[4];j.attempt=ARGV[5];j.leaseUntil=now+45000;j.updatedAt=now;write(p..':gpu:job:'..id,j);worker.jobId=id;write(KEYS[1],worker);write(KEYS[2],q);return cjson.encode(j)
   else finish(j,'cancelled','Chatbot đã khóa hoặc quyền truy cập đã thay đổi.') end
  end
 end;write(KEYS[2],q);return nil`,
      [workerKey(w.id), key(`gpu:queue:${target}:${c.id}`)],
      [w.id, randomUUID()],
    );
    if (!job) return { job: null, open, runId: c.id };
    const s = (await db().get<ChatSession>(job.sessionKey))!;
    return {
      job: {
        requestId: job.id,
        attempt: job.attempt,
        runId: job.runId,
        messages: s.messages.filter((m) => !m.rejected),
        template,
        contextWindowTokens: context,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
      },
      open,
      runId: c.id,
    };
  }
  if (!v.requestId || !v.attempt)
    throw new ApiError("Thiếu request của worker.");
  const j = await db().get<ChatJob>(jobKey(v.requestId));
  if (
    !j ||
    j.target !== target ||
    j.workerId !== w.id ||
    j.attempt !== v.attempt
  )
    throw new ApiError("Request không thuộc worker này.", 409);
  if (j.runId !== c.id) {
    await reconcileChat(target, j.runId);
    return { accepted: false, terminal: true, open: false, runId: c.id };
  }
  if (["completed", "failed", "cancelled"].includes(j.status))
    return {
      accepted: j.status === "completed",
      terminal: true,
      open,
      runId: c.id,
    };
  if (!open || j.runId !== c.id)
    return { accepted: false, terminal: true, open: false, runId: c.id };
  if (action === "heartbeat") {
    const accepted = await script(
      `local j=read(KEYS[1]);if not j or j.attempt~=ARGV[4] or not valid(j) or (j.status~='claimed' and j.status~='running' and j.status~='uncertain') then return 0 end;j.leaseUntil=now+45000;write(KEYS[1],j);return 1`,
      [jobKey(j.id)],
      [v.attempt],
    );
    return { accepted: !!accepted, open, runId: c.id };
  }
  if (action === "prepare") {
    if (j.status === "running")
      return {
        execute: true,
        maxTokens: j.maxTokens,
        inputTokens: j.promptTokens,
      };
    if (j.status !== "claimed") return { execute: false, terminal: true };
    const s = (await db().get<ChatSession>(j.sessionKey))!;
    let max: number;
    try {
      max = Math.min(
        outputBudget(template, s, v.promptTokens!),
        context - 128 - v.promptTokens!,
      );
      if (max < 1)
        throw new ChatLimitError(
          "input",
          "Prompt vượt cửa sổ context của Pod.",
        );
    } catch (e) {
      if (!(e instanceof ChatLimitError)) throw e;
      await script(
        `local j=read(KEYS[1]);if j and j.status=='claimed' and j.attempt==ARGV[4] then finish(j,'failed',ARGV[5]) end;return 1`,
        [jobKey(j.id)],
        [v.attempt, e.message],
      );
      return { execute: false, terminal: true };
    }
    const accepted = await script(
      `
 local j=read(KEYS[1]);if not j or j.attempt~=ARGV[4] or not valid(j) then return 0 end
 if j.status=='running' then return 1 end;if j.status~='claimed' or now>j.leaseUntil then return 0 end
 local s=read(j.sessionKey);if not s or not s.pending or s.pending.requestId~=j.id or s.inputTokens~=tonumber(ARGV[7]) or s.outputTokens~=tonumber(ARGV[8]) then return 0 end
 j.status='running';j.promptTokens=tonumber(ARGV[5]);j.maxTokens=tonumber(ARGV[6]);j.leaseUntil=now+45000;j.updatedAt=now
 s.inputTokens=s.inputTokens+j.promptTokens;s.outputTokens=s.outputTokens+j.maxTokens;s.pending.reserved=j.promptTokens+j.maxTokens
 write(j.sessionKey,s);write(KEYS[1],j);return 1`,
      [jobKey(j.id)],
      [v.attempt, v.promptTokens, max, s.inputTokens, s.outputTokens],
    );
    return { execute: !!accepted, maxTokens: max, inputTokens: v.promptTokens };
  }
  if (action === "complete") {
    if (
      !["running", "uncertain"].includes(j.status) ||
      v.inputTokens !== j.promptTokens ||
      !Number.isInteger(v.outputTokens) ||
      v.outputTokens! < 0 ||
      v.outputTokens! > j.maxTokens! ||
      typeof v.content !== "string"
    )
      throw new ApiError("Kết quả worker không hợp lệ.", 422);
    const accepted = await script(
      `local j=read(KEYS[1]);if not j or j.attempt~=ARGV[4] then return 0 end;if j.status=='completed' then return 1 end;if not valid(j) then finish(j,'cancelled','Chatbot đã khóa.');return 0 end;if j.status~='running' and j.status~='uncertain' then return 0 end;finish(j,'completed',nil,cjson.decode(ARGV[5]));return 1`,
      [jobKey(j.id)],
      [
        v.attempt,
        JSON.stringify({ content: v.content, outputTokens: v.outputTokens }),
      ],
    );
    return { accepted: !!accepted, terminal: true, open, runId: c.id };
  }
  if (action === "fail") {
    await script(
      `local j=read(KEYS[1]);if j and j.attempt==ARGV[4] then finish(j,'failed','Không thể hoàn tất phản hồi. Bạn có thể gửi lại hoặc tạo đoạn chat mới.') end;return 1`,
      [jobKey(j.id)],
      [v.attempt],
    );
    return { accepted: true, terminal: true, open, runId: c.id };
  }
  throw new ApiError("Không tìm thấy thao tác worker.", 404);
}

export async function chatQueueSummary(target: string, run: string) {
  await reconcileChat(target, run);
  const ids = await db().zrange<string[]>(activeJobsKey(target, run), 0, 255);
  const jobs = ids.length
    ? (await db().mget<(ChatJob | null)[]>(...ids.map(jobKey))).filter(
        (j): j is ChatJob => !!j,
      )
    : [];
  return {
    queued: jobs.filter((j) => j.status === "queued").length,
    running: jobs.filter(
      (j) => j.status === "claimed" || j.status === "running",
    ).length,
    oldestQueuedAt: jobs.some((j) => j.status === "queued")
      ? Math.min(
          ...jobs.filter((j) => j.status === "queued").map((j) => j.createdAt),
        )
      : null,
    uncertain: jobs
      .filter((j) => j.status === "uncertain")
      .map((j) => ({ id: j.id, workerId: j.workerId, createdAt: j.createdAt })),
  };
}
export async function settleUncertain(user: SafeUser, requestId: string) {
  if (!user.admin) throw new ApiError("Chỉ admin được đối soát request.", 403);
  const j = await db().get<ChatJob>(jobKey(requestId));
  if (!j) throw new ApiError("Không tìm thấy request.", 404);
  const t = await resolveChatTarget(user, j.workspaceId, j.groupId);
  if (t.ownerId !== user.id)
    throw new ApiError("Request thuộc quản trị viên khác.", 403);
  return script(
    `local j=read(KEYS[1]);if not j or j.status~='uncertain' then return 0 end;finish(j,'failed','Lượt này không xác nhận được kết quả. Ngân sách đã giữ được giữ nguyên; hãy tạo đoạn chat mới.');return 1`,
    [jobKey(requestId)],
  );
}
