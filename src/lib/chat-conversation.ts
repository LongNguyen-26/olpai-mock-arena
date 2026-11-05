import type { ChatPolicy } from "./chat-policy";
import type { ChatSession } from "./workspace-domain";

export interface ConversationMetadata {
  sessionId: string;
  roundId: string;
  runId: string;
  target: string;
  audience: string;
  teamId: string | null;
  createdAt: number;
  updatedAt: number;
  title: string;
  policy?: ChatPolicy;
}
export const isConversationKind = (kind: string) => kind === "chat-session" || kind === "chat-group-session";
export function conversationTitle(content: string) {
  return Array.from(content.replace(/\s+/gu, " ").trim()).slice(0, 64).join("") || "Cuộc trò chuyện";
}
export function conversationRef(kind: string, id: string) {
  return Buffer.from(JSON.stringify([kind, id])).toString("base64url");
}
export function parseConversationRef(ref: string): [string, string] | null {
  if (!/^[A-Za-z0-9_-]{1,900}$/.test(ref)) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(ref, "base64url").toString("utf8"));
    return Array.isArray(v) && v.length === 2 && isConversationKind(v[0]) && typeof v[1] === "string" && v[1].length <= 600 ? [v[0], v[1]] : null;
  } catch { return null; }
}
export function jobConversation(job: Record<string, unknown>, session: ChatSession, now: number): ConversationMetadata | null {
  if (typeof job.sessionId !== "string" || typeof job.roundId !== "string" || typeof job.runId !== "string" || typeof job.target !== "string" || typeof job.audience !== "string") return null;
  return { sessionId: job.sessionId, roundId: job.roundId, runId: job.runId, target: job.target,
    audience: job.audience, teamId: typeof job.teamId === "string" ? job.teamId : null,
    createdAt: Number(job.createdAt) || now, updatedAt: now,
    title: conversationTitle(session.messages.find(m => m.role === "user")?.content ?? "") };
}
export function chatPolicyView(t: ChatPolicy) {
  return { tokenLimitMode: t.tokenLimitMode, sessionTokenLimit: t.sessionTokenLimit,
    inputTokenLimit: t.inputTokenLimit, outputTokenLimit: t.outputTokenLimit };
}
export function contestantSession(s: ChatSession): ChatSession {
  const { conversation: _metadata, ...safe } = s;
  if (safe.error && /groq|runpod|deepseek|qwen|llama|api.?key/i.test(safe.error))
    safe.error = "Chatbot chưa hoàn tất phản hồi. Vui lòng thử lại sau hoặc liên hệ quản trị viên.";
  return safe;
}
export const draftCharacterCount = (value: string) => Array.from(value).length;
