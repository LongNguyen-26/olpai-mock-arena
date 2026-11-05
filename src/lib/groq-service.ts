import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./api-error";
import { db, key, serverNow } from "./db";
import { readApiCredential, putApiCredential, withGroqOwnerLock } from "./api-credentials";
import { encryptSecret, decryptSecret } from "./workspace-crypto";
import { groqModels } from "./groq";
import { getWorkspace } from "./workspaces";
import { getChatGroup, groupKey, type ChatGroup } from "./chat-groups";
import { readGroupIds, readGroupRecord } from "./gpu-repository";
import { runtimeEval } from "./runtime-authority";
import { getContest } from "./rounds";
import { requireWorkspaceTeam } from "./workspace-teams";
import { readTeam, readAdminIds } from "./entity-repository";
import { chatQueueSummary } from "./chat-queue";
import type { SafeUser } from "./types";

const policySchema = z.object({
  tokenLimitMode: z.enum(["turn", "session"]), sessionTokenLimit: z.number().int().min(256).max(16384),
  inputTokenLimit: z.number().int().min(64).max(8192), outputTokenLimit: z.number().int().min(64).max(4096),
});
export const groqAllocationSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(2).max(80),
  model: z.string().trim().min(1).max(160), scope: z.enum(["team", "all"]), teamId: z.string().uuid().nullable().optional(),
  roundId: z.string().uuid(), policy: policySchema, parallel: z.number().int().min(1).max(8),
  requestsPerMinute: z.number().int().min(1).max(1000),
});
const adminOnly = (user: SafeUser) => { if (!user.admin) throw new ApiError("Chỉ admin được quản lý Groq.", 403); };
export async function groqCredentialState(user: SafeUser) {
  adminOnly(user);
  const c = await readApiCredential(user.id);
  return { configured: !!c, masked: c?.masked ?? "", updatedAt: c?.updatedAt ?? null };
}
export async function availableGroqModels(user: SafeUser) {
  adminOnly(user);
  const c = await readApiCredential(user.id);
  if (!c) throw new ApiError("Hãy lưu Groq API key trước.", 409);
  return { models: await groqModels(decryptSecret(c.ciphertext)) };
}
export async function changeGroqCredential(user: SafeUser, apiKey: string | null) {
  adminOnly(user);
  // Validate outside the short owner/configuration lock. Listing models makes no inference call.
  if (apiKey) await groqModels(apiKey);
  await withGroqOwnerLock(user.id, async () => {
    const previous = await readApiCredential(user.id);
    if (apiKey && previous && decryptSecret(previous.ciphertext) === apiKey) return;
    for (const id of await readGroupIds()) {
      const g = await getChatGroup(id);
      if (g.ownerId !== user.id || g.provider !== "groq" || g.retired) continue;
      const c = await getContest(g.roundId);
      for (const run of new Set([g.runId, c.id])) {
        const q = await chatQueueSummary(`group:${id}`, run);
        if (!g.paused || q.queued || q.running || q.uncertain.length)
          throw new ApiError("Tạm ngừng các chatbot Groq và chờ/đối soát hết request trước khi thay hoặc xóa API key.", 409);
      }
    }
    await putApiCredential(user.id, apiKey ? { ciphertext: encryptSecret(apiKey), masked: `••••${apiKey.slice(-4)}`,
      revision: randomUUID(), updatedAt: await serverNow() } : null);
  });
  return groqCredentialState(user);
}
export async function createGroqChatbot(user: SafeUser, input: z.infer<typeof groqAllocationSchema>) {
  adminOnly(user);
  const v = groqAllocationSchema.parse(input);
  const previous = await readGroupRecord(v.id);
  if (previous) {
    if (previous.ownerId === user.id && previous.allocationFingerprint === JSON.stringify(v)) return { id: v.id };
    throw new ApiError("Mã cấp phát đã được dùng cho cấu hình khác.", 409);
  }
  const credential = await readApiCredential(user.id);
  if (!credential) throw new ApiError("Hãy lưu Groq API key trước.", 409);
  const model = (await groqModels(decryptSecret(credential.ciphertext))).find(m => m.id === v.model);
  if (!model) throw new ApiError("Model không khả dụng cho API key này. Hãy làm mới danh sách.", 409);
  if (v.policy.outputTokenLimit > model.maxCompletionTokens || v.policy.inputTokenLimit + v.policy.outputTokenLimit + 128 > model.contextWindow)
    throw new ApiError("Giới hạn token vượt khả năng của model đã chọn.");
  return withGroqOwnerLock(user.id, async () => {
    if ((await readApiCredential(user.id))?.revision !== credential.revision)
      throw new ApiError("API key vừa thay đổi. Hãy thử lại.", 409);
    const c = await getContest(v.roundId), teamId = v.scope === "team" ? v.teamId : null;
    if (v.scope === "team") {
      const team = teamId ? await readTeam(teamId) : null;
      if (!team?.members.length) throw new ApiError("Chọn đội có thành viên.");
      await requireWorkspaceTeam(team, c);
      const legacyId = await db().get<string>(key(`gpu:active:${teamId}`));
      if (legacyId) {
        const legacy = await getWorkspace(legacyId);
        if (legacy.roundId === v.roundId && legacy.status !== "terminated") throw new ApiError("Đội đã có Pod cung cấp dịch vụ. Hãy kiểm tra cấu hình cũ trước.", 409);
      }
    }
    const g: ChatGroup = { id: v.id, name: v.name, ownerId: user.id, provider: "groq",
      groq: { ...model, parallel: v.parallel, requestsPerMinute: v.requestsPerMinute }, roundId: v.roundId, runId: c.id,
      scope: v.scope, teamId: teamId ?? null, workspaceIds: [], template: { id: v.id, name: v.name, ...v.policy },
      contextWindowTokens: model.contextWindow, paused: false, createdAt: await serverNow() };
    const reservation = key(`gpu:active:v2:${g.scope}:${g.teamId ?? "all"}:${g.roundId}:llm`);
    const result = await runtimeEval<string[], string>(`
      local old=redis.call('GET',KEYS[2]);if old then local g=cjson.decode(old);if g.ownerId==ARGV[3] and g.allocationFingerprint==ARGV[4] then return 'ok' end;return 'duplicate' end
      if redis.call('EXISTS',KEYS[1])==1 then return 'reserved' end
      redis.call('SET',KEYS[1],ARGV[1]);redis.call('SET',KEYS[2],ARGV[2]);redis.call('SADD',KEYS[3],ARGV[5]);return 'ok'`,
      [reservation, groupKey(g.id), key("gpu:chat-groups")],
      [`group:${g.id}`, JSON.stringify({ ...g, allocationFingerprint: JSON.stringify(v) }), user.id, JSON.stringify(v), g.id]);
    if (result !== "ok") throw new ApiError(result === "reserved" ? "Phạm vi/vòng này đã có Chatbot. Hãy đóng cấu hình cũ trước." : "Mã cấp phát đã được dùng cho cấu hình khác.", 409);
    return { id: g.id };
  });
}
export async function groqOwnerActive(owner: string) {
  return (await readAdminIds()).includes(owner) && !!await readApiCredential(owner);
}
