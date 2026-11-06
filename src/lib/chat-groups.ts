import type { ChatTemplate } from "./chat-policy";
import type { GroqConfiguration } from "./groq";
import { readApiCredential } from "./api-credentials";
import { runtimeEval } from "./runtime-authority";
import { usingPostgres, sqlTransaction, namespace, sqlNow } from "./sql";
import { putSqlHistory } from "./sql-chat";
import { runtimeSignal } from "./sql-runtime";
import { runpodAvailable, requireRunpod } from "./runtime-mode";
import { randomUUID } from "node:crypto";
import { db, key, serverNow } from "./db";
import { ApiError } from "./auth";
import { getContest, requireRegistration } from "./rounds";
import { readTemplates } from "./workspace-templates";
import {
  chatContextWindow,
  chatPolicyFields,
  chatbotOpen,
  estimatedCost,
  type WorkspaceTemplate,
} from "./workspace-domain";
import { roundVisible } from "./round-visibility";
import { getWorkspace } from "./workspaces";
import { requireWorkspaceTeam } from "./workspace-teams";
import {
  chatWorkers,
  chatQueueSummary,
  LEASE_MS,
  supportedQueueProtocol,
} from "./chat-queue";
import type { SafeUser, Team } from "./types";
import { readTeam, readAdminIds } from "./entity-repository";
import { readGroupRecord,readGroupIds } from "./gpu-repository";

export interface ChatGroup {
  id: string;
  name: string;
  ownerId: string;
  roundId: string;
  runId: string;
  scope: "team" | "all";
  teamId: string | null;
  workspaceIds: string[];
  provider?: "runpod" | "groq";
  groq?: GroqConfiguration;
  template: ChatTemplate;
  contextWindowTokens: number;
  modelFingerprint?: string;
  paused: boolean;
  retired?: boolean;
  createdAt: number;
  allocationFingerprint?: string;
}
export const groupKey = (id: string) => key(`gpu:chat-group:${id}`);
export async function getChatGroup(id: string) {
  const g = await readGroupRecord(id);
  if (!g) throw new ApiError("Không tìm thấy nhóm Chatbot.", 404);
  if (!Array.isArray(g.workspaceIds)) g.workspaceIds = [];
  g.teamId ??= null;
  return g;
}
export async function groupTemplate(g: ChatGroup) {
  if (g.provider === "groq") return g.template;
  const saved = (await readTemplates(g.ownerId))[g.template.id],
    next = { ...g.template };
  if (saved)
    for (const f of chatPolicyFields) Object.assign(next, { [f]: saved[f] });
  return next;
}
export async function accessChatGroup(user: SafeUser, id: string) {
  const group = await getChatGroup(id),
    c = await getContest(group.roundId);
  if (!roundVisible(c, user.admin) || (group.retired && !user.admin))
    throw new ApiError("Không tìm thấy nhóm Chatbot.", 404);
  if (!user.admin) {
    const team = user.teamId
      ? await readTeam(user.teamId)
      : null;
    if (
      !team?.members.includes(user.id) ||
      (group.scope === "team" && team.id !== group.teamId)
    )
      throw new ApiError("Bạn không thuộc đội được dùng Chatbot này.", 403);
    if (group.scope === "team") await requireRegistration(user, c);
  }
  return { group, c };
}
export async function createChatGroup(...args: Parameters<typeof createRunpodChatGroup>): Promise<ChatGroup> {
  return usingPostgres() ? sqlTransaction(() => createRunpodChatGroup(...args), true) : createRunpodChatGroup(...args);
}
async function createRunpodChatGroup(
  user: SafeUser,
  v: {
    id: string;
    name: string;
    scope: "team" | "all";
    teamId?: string | null;
    roundId: string;
    templateId: string;
  },
): Promise<ChatGroup> {
  if (!user.admin) throw new ApiError("Chỉ admin được tạo nhóm.", 403);
  requireRunpod(true);
  if (usingPostgres()) {
    const occupied = await sqlTransaction(async client => (await client.query("select 1 from arena.runtime_history where ns=$1 and kind='chat-group' and round_id=$2 and payload->>'provider'='groq' and coalesce((payload->>'retired')::boolean,false)=false and payload->>'scope'=$3 and coalesce(payload->>'teamId','all')=$4 limit 1", [namespace(), v.roundId, v.scope, v.scope === "all" ? "all" : v.teamId])).rowCount);
    if (occupied) throw new ApiError("Phạm vi/vòng này đã có Chatbot Groq.", 409);
  }
  const existing = await readGroupRecord(v.id);
  if (existing) {
    if (
      existing.ownerId !== user.id ||
      existing.roundId !== v.roundId ||
      existing.name !== v.name ||
      existing.scope !== v.scope ||
      existing.teamId !== (v.scope === "all" ? null : v.teamId) ||
      existing.template.id !== v.templateId
    )
      throw new ApiError("Mã nhóm đã được sử dụng.", 409);
    return existing;
  }
  const c = await getContest(v.roundId),
    t = (await readTemplates(user.id))[v.templateId];
  if (!t || t.services !== "llm")
    throw new ApiError("Chọn template Chỉ Chatbot đã lưu.", 409);
  const team = v.teamId ? await readTeam(v.teamId) : null;
  if (v.scope === "team" && !team?.members.length)
    throw new ApiError("Chọn đội có thành viên.");
  if (v.scope === "team") await requireWorkspaceTeam(team!, c);
  const g: ChatGroup = {
    id: v.id,
    name: v.name,
    ownerId: user.id,
    roundId: v.roundId,
    runId: c.id,
    scope: v.scope,
    teamId: v.scope === "all" ? null : v.teamId!,
    workspaceIds: [],
    template: t,
    contextWindowTokens: chatContextWindow(t),
    paused: false,
    createdAt: await serverNow(),
  };
  const reservation = key(
    `gpu:active:v2:${g.scope}:${g.teamId ?? "all"}:${g.roundId}:llm`,
  );
  const legacy = g.teamId
    ? await db().get<string>(key(`gpu:active:${g.teamId}`))
    : null;
  if (legacy) {
    const old = await getWorkspace(legacy);
    if (old.roundId === g.roundId && old.status !== "terminated")
      throw new ApiError("Đội đã có Pod cung cấp Chatbot.", 409);
  }
  const ok = await runtimeEval(
    "if redis.call('EXISTS',KEYS[2])==1 then return 2 end;if redis.call('EXISTS',KEYS[1])==1 then return 0 end;redis.call('SET',KEYS[1],ARGV[1]);redis.call('SET',KEYS[2],ARGV[2]);redis.call('SADD',KEYS[3],ARGV[3]);return 1",
    [reservation, groupKey(g.id), key("gpu:chat-groups")],
    [`group:${g.id}`, JSON.stringify(g), g.id],
  );
  if (!ok)
    throw new ApiError(
      "Phạm vi/vòng này đã có dịch vụ Chatbot. Chọn nhóm hiện có.",
      409,
    );
  if (ok === 2) return createChatGroup(user, v);
  return g;
}
export async function controlChatGroup(
  user: SafeUser,
  id: string,
  action: "pause" | "resume" | "retire",
) {
  const g = await getChatGroup(id);
  if (usingPostgres() && g.provider === "groq") return sqlTransaction(async client => {
    const current = (await client.query("select payload from arena.runtime_history where ns=$1 and kind='chat-group' and id=$2", [namespace(), id])).rows[0]?.payload as ChatGroup;
    if (!user.admin || current.ownerId !== user.id) throw new ApiError("Nhóm thuộc quản trị viên khác.", 403);
    if (current.retired && action !== "retire") throw new ApiError("Nhóm đã đóng.", 409);
    if (action === "retire") {
      const pending = await client.query("select 1 from arena.runtime_history where ns=$1 and kind='chat-job' and payload->>'groupId'=$2 and status in ('queued','claimed','running','uncertain') and (expires_at is null or expires_at>$3) limit 1", [namespace(), id, await sqlNow(client)]);
      if (pending.rowCount) throw new ApiError("Nhóm còn request chưa hoàn tất.", 409);
      current.retired = true;
    }
    current.paused = action !== "resume";
    await putSqlHistory(client, "chat-group", id, current as unknown as Record<string, unknown>, await sqlNow(client));
    return { ok: true };
  }, true);
  requireRunpod(action === "resume");
  if (!user.admin || g.ownerId !== user.id)
    throw new ApiError("Nhóm thuộc quản trị viên khác.", 403);
  let currentRun = g.runId;
  if (action === "retire") {
    const members = await Promise.all(g.workspaceIds.map(getWorkspace));
    if (members.some((w) => w.status !== "terminated"))
      throw new ApiError(
        "Thu hồi các Pod trong nhóm trước khi đóng nhóm.",
        409,
      );
    const c = await getContest(g.roundId),
      q = await chatQueueSummary(`group:${g.id}`, c.id);
    currentRun = c.id;
    if (q.queued || q.running || q.uncertain.length)
      throw new ApiError("Nhóm còn request chưa hoàn tất.", 409);
  }
  const changed = await runtimeEval(
    "local g=cjson.decode(redis.call('GET',KEYS[1]));if ARGV[1]=='retire' and (#g.workspaceIds~=tonumber(ARGV[3]) or redis.call('ZCARD',KEYS[3])>0) then return 0 end;g.paused=ARGV[1]~='resume';if ARGV[1]=='retire' then g.retired=true;if redis.call('GET',KEYS[2])==ARGV[2] then redis.call('DEL',KEYS[2]) end end;redis.call('SET',KEYS[1],cjson.encode(g));return 1",
    [
      groupKey(id),
      key(`gpu:active:v2:${g.scope}:${g.teamId ?? "all"}:${g.roundId}:llm`),
      key(`gpu:jobs:group:${g.id}:${currentRun}`),
    ],
    [action, `group:${id}`, g.workspaceIds.length],
  );
  if (!changed)
    throw new ApiError("Nhóm vừa thay đổi. Hãy tải lại và đối soát.", 409);
  return { ok: true };
}
export async function drainChatWorker(
  user: SafeUser,
  id: string,
  draining: boolean,
) {
  const w = await getWorkspace(id);
  if (!user.admin || w.ownerId !== user.id)
    throw new ApiError("Pod thuộc quản trị viên khác.", 403);
  await db().set(key(`gpu:drain:${id}`), draining);
  return { ok: true };
}
export async function chatGroupViews(user: SafeUser) {
  const ids = await readGroupIds();
  const now = await serverNow();
  return (
    await Promise.all(
      ids.map(async (id) => {
        let result;
        try {
          result = await accessChatGroup(user, id);
        } catch (e) {
          if (e instanceof ApiError && [403, 404].includes(e.status))
            return null;
          throw e;
        }
        const { group: g, c } = result;
        if (g.retired) return null;
        if (g.provider !== "groq" && !runpodAvailable()) return null;
        const [workers, members] = await Promise.all([
          usingPostgres() && g.provider === "groq" ? Promise.resolve([]) : chatWorkers(g.provider === "groq" ? [`groq:${g.id}`] : g.workspaceIds),
          Promise.all(g.workspaceIds.map(getWorkspace)),
        ]);
        const apiReady = g.provider === "groq" && (await readAdminIds()).includes(g.ownerId) && !!await readApiCredential(g.ownerId);
        const ready = workers.filter(
          (w) =>
            w.ready &&
            !w.draining &&
            supportedQueueProtocol(w.protocol) &&
            w.runId === c.id &&
            now - w.heartbeatAt < LEASE_MS,
        ).length;
        return {
          id: g.id,
          name: user.admin ? g.name : g.scope === "all" ? "Chatbot dùng chung" : "Chatbot của đội",
          provider: user.admin ? g.provider ?? "runpod" : undefined,
          model: user.admin ? g.groq?.id ?? "DeepSeek" : undefined,
          preparingResources: g.provider !== "groq" && !members.some(w=>w.status!=="terminated"),
          roundId: g.roundId,
          scope: g.scope,
          teamId: g.teamId,
          paused: g.paused,
          canManage: user.admin && user.id === g.ownerId,
          chatbotEnabled:
            !g.paused &&
            (apiReady || (g.provider !== "groq" && ready > 0)) &&
            chatbotOpen({ runId: c.id, services: "llm" }, c, now),
          ...(user.admin
            ? {
                workspaceIds: g.workspaceIds,
                templateId: g.template.id,
                ready: g.provider === "groq" ? (apiReady ? 1 : 0) : ready,
                readySlots: g.provider === "groq" ? (apiReady ? (g.groq?.parallel ?? 1) : 0) : workers
                  .filter(
                    (w) =>
                      w.ready &&
                      !w.draining &&
                      supportedQueueProtocol(w.protocol) &&
                      w.runId === c.id &&
                      now - w.heartbeatAt < LEASE_MS,
                  )
                  .reduce((sum, w) => sum + (w.capacity ?? 1), 0),
                total: members.filter(
                  (w) => w.podId && w.status !== "terminated",
                ).length,
                estimatedUsd: members.reduce(
                  (sum, w) => sum + (w.podId ? estimatedCost(w, now) : 0),
                  0,
                ),
                hourlyUsd: members.reduce(
                  (sum, w) => sum + (w.podId ? w.meterRate : 0),
                  0,
                ),
                providerError: g.provider === "groq" ? usingPostgres() ? await runtimeSignal(`groq:error:${g.id}`) : await db().get<string>(key(`groq:error:${g.id}`)) : null,
                queue: await chatQueueSummary(`group:${id}`, c.id),
              }
            : {}),
        };
      }),
    )
  ).filter((g) => g !== null);
}
