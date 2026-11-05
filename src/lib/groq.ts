import { z } from "zod";

const BASE = "https://api.groq.com/openai/v1";
export interface GroqModel { id: string; contextWindow: number; maxCompletionTokens: number }
export interface GroqConfiguration extends GroqModel { parallel: number; requestsPerMinute: number }
export class GroqError extends Error {
  constructor(public kind: "rejected" | "rate_limit" | "uncertain", message: string, public retryAfter = 0) {
    super(message);
  }
}
const modelSchema = z.object({ id: z.string().min(1).max(160), active: z.boolean().optional(),
  context_window: z.number().int().positive(), max_completion_tokens: z.number().int().positive().optional() });
// These families support the text-only Chat Completions contract used here.
// Audio, guard, compound/tool systems and unknown contracts are not offered.
export const isGroqChatModel = (id: string) =>
  /^(openai\/gpt-oss-(?:20b|120b)|llama-[\w.-]+|meta-llama\/llama-[\w.-]+|qwen\/qwen[\w.-]+|deepseek-r1[\w.-]*)$/i.test(id);

async function request(apiKey: string, path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(BASE + path, { method: body ? "POST" : "GET", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body ? 120_000 : 15_000) });
  } catch { throw new GroqError("uncertain", "Mất kết nối với Groq; chưa xác nhận được kết quả."); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      throw new GroqError("rate_limit", "Groq đang giới hạn lượt gọi. Hệ thống sẽ thử lại sau.",
        Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 60);
    }
    const message = response.status === 401 ? "Groq API key không hợp lệ hoặc đã bị thu hồi."
      : response.status === 403 ? "API key không có quyền sử dụng model Groq này."
      : response.status === 404 ? "Model Groq không còn khả dụng. Hãy làm mới danh sách model."
      : response.status >= 500 ? "Groq gặp lỗi; chưa xác nhận được kết quả."
      : "Groq từ chối yêu cầu. Hãy kiểm tra model, context và hạn mức tài khoản.";
    throw new GroqError(response.status >= 500 ? "uncertain" : "rejected", message);
  }
  try { return await response.json(); }
  catch { throw new GroqError("uncertain", "Phản hồi Groq chưa đầy đủ; cần đối soát yêu cầu."); }
}
export async function groqModels(apiKey: string): Promise<GroqModel[]> {
  const value = z.object({ data: z.array(z.unknown()) }).safeParse(await request(apiKey, "/models"));
  if (!value.success) throw new GroqError("rejected", "Không đọc được danh sách model Groq.");
  return value.data.data.flatMap(raw => {
    const parsed = modelSchema.safeParse(raw);
    if (!parsed.success || parsed.data.active === false || !isGroqChatModel(parsed.data.id)) return [];
    const m = parsed.data;
    return [{ id: m.id, contextWindow: m.context_window,
      maxCompletionTokens: Math.min(m.max_completion_tokens ?? m.context_window, m.context_window) }];
  }).sort((a,b) => a.id.localeCompare(b.id));
}
export type GroqMessage = { role: "user" | "assistant"; content: string };
// Deliberately conservative UTF-8 byte upper bound, including generous template
// overhead. This is a reservation, never represented as exact tokenizer usage.
export function groqPromptReservation(messages: GroqMessage[]) {
  return 128 + messages.reduce((n,m) => n + Buffer.byteLength(m.content, "utf8") + 64, 0);
}
export function fitGroqHistory(messages: GroqMessage[], inputBudget: number) {
  const fitted = [...messages];
  while (fitted.length > 2 && groqPromptReservation(fitted) > inputBudget) fitted.splice(0, 2);
  return fitted;
}
const completionSchema = z.object({ id: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable() })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().positive(), completion_tokens: z.number().int().nonnegative() }) });
export async function groqComplete(apiKey: string, model: string, messages: GroqMessage[], maxTokens: number) {
  const parsed = completionSchema.safeParse(await request(apiKey, "/chat/completions", {
    model, messages, max_completion_tokens: maxTokens, stream: false, n: 1,
  }));
  if (!parsed.success) throw new GroqError("uncertain", "Groq chưa trả đủ nội dung và thống kê token; cần đối soát yêu cầu.");
  const value = parsed.data;
  return { content: value.choices[0].message.content || "Model đã kết thúc lượt mà chưa trả nội dung. Hãy tạo đoạn chat mới hoặc báo admin điều chỉnh giới hạn output.",
    inputTokens: value.usage.prompt_tokens, outputTokens: value.usage.completion_tokens, providerRequestId: value.id };
}
