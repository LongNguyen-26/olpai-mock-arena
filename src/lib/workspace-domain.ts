import { z } from "zod";
import { phaseOf } from "./domain";
import { roundVisible } from "./round-visibility";
import type { Contest } from "./types";
import type { PodStartupFailure } from "./runpod-startup";
import {
  hasService,
  type WorkspaceScope,
  type WorkspaceServices,
} from "./workspace-options";

export const templateSchema = z
  .object({
    id: z.string().uuid(),
    services: z.enum(["both", "llm", "jupyter"]).optional(),
    name: z.string().trim().min(2).max(80),
    gpuTypeId: z.string().trim().min(1).max(100),
    cloudType: z.enum(["COMMUNITY", "SECURE"]),
    imageName: z
      .string()
      .trim()
      .max(250)
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/,
        "Nhập image Docker đã build và push.",
      ),
    minRAMPerGPU: z.number().int().min(1).max(1024),
    minVCPUPerGPU: z.number().int().min(1).max(128),
    containerDiskInGb: z.number().int().min(20).max(500),
    volumeInGb: z.number().int().min(50).max(2000),
    revision: z.string().uuid().optional(),
    createdBy: z.string().optional(),
    updatedBy: z.string().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    tokenLimitMode: z.enum(["session", "turn"]).optional(),
    sessionTokenLimit: z.number().int().min(256).max(16384),
    inputTokenLimit: z.number().int().min(64).max(8192),
    outputTokenLimit: z.number().int().min(64).max(4096),
  })
  .refine(
    (t) => !!t.tokenLimitMode || t.inputTokenLimit < t.sessionTokenLimit,
    "Input limit phải nhỏ hơn tổng token mỗi phiên.",
  );
export type WorkspaceTemplate = z.infer<typeof templateSchema>;
export const defaultTemplate: WorkspaceTemplate = {
  id: "00000000-0000-4000-8000-000000000040",
  name: "A40 · DeepSeek 32B Q4 · Luyện tập",
  gpuTypeId: "NVIDIA A40",
  cloudType: "SECURE",
  imageName: "",
  minRAMPerGPU: 48,
  minVCPUPerGPU: 8,
  containerDiskInGb: 30,
  volumeInGb: 100,
  sessionTokenLimit: 2000,
  inputTokenLimit: 1800,
  outputTokenLimit: 1024,
};
export type WorkspaceStatus =
  | "provisioning"
  | "reconciling"
  | "running"
  | "stopped"
  | "terminated"
  | "failed";
export interface RuntimeHealth {
  chatLocked?: boolean;
  jupyter: boolean;
  llm: boolean;
  publicReady: boolean;
  privateReady: boolean;
  stage: string;
  gpu?: string;
  error?: string;
  modelStage?: string;
  chatQueueProtocol?: number;
  modelFingerprint?: string;
}
export interface Workspace {
  id: string;
  teamId: string | null;
  scope?: WorkspaceScope;
  services?: WorkspaceServices;
  loadDataset?: boolean;
  chatGroupId?: string;
  allocationRequestId?: string;
  reservationVersion?: 2;
  teamName: string;
  roundId: string;
  runId: string;
  roundTitle: string;
  ownerId: string;
  podName: string;
  podId: string | null;
  status: WorkspaceStatus;
  template: WorkspaceTemplate;
  contextWindowTokens?: number;
  metricsVisible?: boolean;
  secret: string;
  jupyterSecret: string;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
  meterAt: number;
  meterRate: number;
  accruedUsd: number;
  quotedGpuRate: number;
  health: RuntimeHealth | null;
  uptimeSeconds?: number | null;
  uptimeObservedAt?: number | null;
  startupFailure?: PodStartupFailure | null;
  startupCheckedAt?: number | null;
  error: string | null;
}
export type WorkspaceView = Omit<
  Workspace,
  | "secret"
  | "jupyterSecret"
  | "ownerId"
  | "reservationVersion"
  | "scope"
  | "services"
> & {
  scope: WorkspaceScope;
  services: WorkspaceServices;
  estimatedUsd: number;
  notebookEnabled?: boolean;
  chatbotEnabled?: boolean;
  accessMessage?: string;
};

export function workspaceAccess(
  w: Workspace,
  c: Contest,
  now: number,
  admin = false,
  registered = true,
) {
  const phase = phaseOf(c, now);
  const current =
    w.runId === c.id && w.status === "running" && roundVisible(c, admin);
  const notebookWindow =
    admin || (registered && ["public", "private"].includes(phase));
  const chatWindow = (admin || registered) && chatbotOpen(w, c, now);
  return {
    notebookEnabled:
      hasService(w, "jupyter") &&
      current &&
      notebookWindow &&
      !!w.health?.jupyter,
    chatbotEnabled:
      hasService(w, "llm") &&
      current &&
      chatWindow &&
      !!w.health?.llm &&
      !w.health?.chatLocked,
    accessMessage: !current
      ? "Pod chưa sẵn sàng cho lượt thi hiện tại."
      : !registered && !admin
        ? "Bạn cần được duyệt tham gia vòng luyện này."
        : hasService(w, "jupyter") && !notebookWindow
          ? "Notebook mở trong giai đoạn public và private."
          : hasService(w, "jupyter") && !w.health?.jupyter
            ? "JupyterLab đang khởi động; chưa mở truy cập."
            : hasService(w, "llm") && chatWindow && !w.health?.llm
              ? (w.health?.modelStage ?? "Đang tải hoặc khởi động DeepSeek.")
              : "",
  };
}
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  rejected?: boolean;
}
export interface ChatSession {
  messages: ChatMessage[];
  inputTokens: number;
  outputTokens: number;
  pending?: { requestId: string; reserved: number };
  error?: string;
  lastRequestId?: string;
  lastTurn?: { inputTokens: number; outputTokens: number; rejected?: boolean };
  limitNotice?: string;
  exhausted?: {
    reason: "input" | "session";
    message: string;
    promptTokens: number;
  };
}
export const emptySession = (): ChatSession => ({
  messages: [],
  inputTokens: 0,
  outputTokens: 0,
});
export function chatbotOpen(
  w: Pick<Workspace, "runId" | "services">,
  c: Contest,
  now: number,
) {
  return (
    roundVisible(c) &&
    hasService(w, "llm") &&
    w.runId === c.id &&
    phaseOf(c, now) === "public"
  );
}
export function outputBudget(
  t: WorkspaceTemplate,
  s: ChatSession,
  promptTokens: number,
) {
  if (!Number.isInteger(promptTokens) || promptTokens < 1)
    throw new Error("Dịch vụ trả số token không hợp lệ.");
  if (s.exhausted) throw new ChatLimitError("session", s.exhausted.message);
  if (promptTokens > t.inputTokenLimit)
    throw new ChatLimitError(
      "input",
      `Input vượt giới hạn ${t.inputTokenLimit} token (gồm lịch sử và định dạng hội thoại).`,
    );
  const remaining =
    t.sessionTokenLimit - s.inputTokens - s.outputTokens - promptTokens;
  if (remaining <= 0)
    throw new ChatLimitError(
      "session",
      "Phiên đã hết ngân sách token. Dùng /new để tạo phiên mới.",
    );
  if (t.tokenLimitMode === "session") {
    if (s.inputTokens + promptTokens > t.inputTokenLimit)
      throw new ChatLimitError(
        "session",
        "Input cộng dồn đã vượt ngân sách của phiên.",
      );
    const remainingOutput = t.outputTokenLimit - s.outputTokens;
    if (remainingOutput < 1)
      throw new ChatLimitError(
        "session",
        "Output của phiên đã hết ngân sách token.",
      );
    return Math.min(remainingOutput, remaining);
  }
  return Math.min(t.outputTokenLimit, remaining);
}
export class ChatLimitError extends Error {
  constructor(
    public reason: "input" | "session",
    message: string,
  ) {
    super(message);
  }
}
export function exhaustChatSession(
  t: WorkspaceTemplate,
  s: ChatSession,
  content: string,
  requestId: string,
  promptTokens: number,
  error: ChatLimitError,
): ChatSession {
  return {
    ...s,
    messages: [...s.messages, { role: "user", content }],
    // A rejected oversized turn consumes the rest of this session by policy.
    inputTokens: Math.max(
      s.inputTokens,
      t.tokenLimitMode === "session"
        ? t.inputTokenLimit
        : t.sessionTokenLimit - s.outputTokens,
    ),
    lastTurn: { inputTokens: promptTokens, outputTokens: 0, rejected: true },
    lastRequestId: requestId,
    exhausted: {
      reason: error.reason,
      promptTokens,
      message:
        error.reason === "input"
          ? `${error.message} Tin nhắn đã được lưu; phiên đã hết ngân sách token. Dùng /new hoặc Đoạn chat mới để tiếp tục.`
          : "Tin nhắn đã được lưu; phiên đã hết ngân sách token. Dùng /new hoặc Đoạn chat mới để tiếp tục.",
    },
  };
}
export const chatPolicyFields = [
  "tokenLimitMode",
  "sessionTokenLimit",
  "inputTokenLimit",
  "outputTokenLimit",
] as const;
export function chatContextWindow(t: WorkspaceTemplate) {
  return (
    Math.min(t.sessionTokenLimit, t.inputTokenLimit + t.outputTokenLimit) + 128
  );
}
export function estimatedCost(
  w: Pick<Workspace, "meterAt" | "meterRate" | "accruedUsd">,
  now: number,
) {
  return w.accruedUsd + (Math.max(0, now - w.meterAt) / 3600000) * w.meterRate;
}
export function meter(
  w: Workspace,
  now: number,
  status: WorkspaceStatus,
  rate: number,
): Workspace {
  return {
    ...w,
    health: status === "stopped" || status === "terminated" ? null : w.health,
    accruedUsd: estimatedCost(w, now),
    meterAt: now,
    meterRate: rate,
    status,
    updatedAt: now,
  };
}
export function workspaceView(
  w: Workspace,
  now: number,
  admin = true,
): WorkspaceView {
  const {
    secret: _s,
    jupyterSecret: _j,
    ownerId: _o,
    reservationVersion: _r,
    ...safe
  } = w;
  if (!admin && w.metricsVisible === false) {
    if (safe.health) {
      const { gpu: _gpu, ...health } = safe.health;
      safe.health = health;
    }
    delete safe.uptimeSeconds;
    delete safe.uptimeObservedAt;
  }
  if (!w.podId) {
    safe.meterRate = 0;
    safe.accruedUsd = 0;
  }
  return {
    ...safe,
    scope: w.scope ?? "team",
    services: w.services ?? "both",
    estimatedUsd: estimatedCost(safe, now),
  };
}
export function driveFileId(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "drive.google.com")
    throw new Error("Chỉ dùng liên kết Google Drive HTTPS.");
  const id =
    url.pathname.match(/^\/file\/d\/([\w-]+)/)?.[1] ??
    url.searchParams.get("id");
  if (!id || !/^[\w-]{10,200}$/.test(id))
    throw new Error("Liên kết Drive không có file ID hợp lệ.");
  return id;
}
