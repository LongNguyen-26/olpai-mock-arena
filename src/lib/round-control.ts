import { z } from "zod";
import { ApiError } from "./auth";
import {
  applyPrivateTransition,
  phaseOf,
  privateStart,
  submissionPolicy,
} from "./domain";
import { ROUND_POLICY_LUA } from "./round-policy-lua";
import type { Contest } from "./types";

const time = z.number().int().positive().max(8_640_000_000_000_000).nullable();
export const guardedRoundActions = [
  "timing",
  "open-private",
  "private-policy",
  "submission-access",
  "chatbot-access",
  "notebook-access",
  "practice-open",
  "practice-close",
];
export const roundControlSchema = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("timing"), privateAt: time, endAt: time }),
    z.object({
      action: z.literal("open-private"),
      lockPublic: z.boolean(),
      revokeChatbot: z.boolean(),
      endAt: time,
    }),
    z.object({
      action: z.literal("private-policy"),
      lockPublic: z.boolean(),
      revokeChatbot: z.boolean(),
    }),
    z.object({
      action: z.literal("submission-access"),
      split: z.enum(["public", "private"]),
      visible: z.boolean(),
      enabled: z.boolean(),
    }),
    z.object({
      action: z.literal("chatbot-access"),
      enabled: z.boolean(),
      until: time,
    }),
    z.object({ action: z.literal("notebook-access"), enabled: z.boolean() }),
    z.object({
      action: z.literal("practice-open"),
      endAt: time,
      publicVisible: z.boolean(),
      privateVisible: z.boolean(),
      chatbotEnabled: z.boolean(),
      chatbotUntil: time,
      notebookEnabled: z.boolean(),
    }),
    z.object({ action: z.literal("practice-close") }),
  ])
  .and(
    z.object({
      runId: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      requestId: z.string().uuid(),
    }),
  );
export type RoundControl = z.infer<typeof roundControlSchema>;

export function reduceRoundControl(
  original: Contest,
  v: RoundControl,
  now: number,
): Contest {
  const c = applyPrivateTransition(original, now),
    phase = phaseOf(c, now);
  const active = ["public", "private", "practice"].includes(phase);
  const future = (t: number | null) => {
    if (t != null && t <= now)
      throw new ApiError("Giờ kết thúc/thu hồi phải ở tương lai.", 409);
  };
  let next = { ...c };
  if (v.action === "private-policy") {
    if (!["waiting", "scheduled", "public"].includes(phase))
      throw new ApiError("Private đã bắt đầu; hãy chỉnh quyền hiện tại.", 409);
    next.privatePolicy = {
      lockPublic: v.lockPublic,
      revokeChatbot: v.revokeChatbot,
    };
  } else if (v.action === "timing") {
    if (!active)
      throw new ApiError("Chỉ điều chỉnh lịch khi vòng đang mở.", 409);
    future(v.endAt);
    if (phase === "practice")
      next.practice = { ...c.practice!, endAt: v.endAt };
    else {
      const p = privateStart(c);
      if (phase === "private" && v.privateAt !== p)
        throw new ApiError(
          "Private đã bắt đầu; không thể đổi ngược giai đoạn.",
          409,
        );
      if (phase === "public" && v.privateAt != null && v.privateAt <= now)
        throw new ApiError(
          "Dùng Chuyển sang private ngay để xác nhận quyền khi chuyển giai đoạn.",
          409,
        );
      if (v.endAt != null && v.privateAt != null && v.endAt <= v.privateAt)
        throw new ApiError("Giờ kết thúc phải sau mốc private.", 409);
      next = {
        ...next,
        timingVersion: 1,
        privateAt: v.privateAt,
        endAt: v.endAt,
        forcedEndAt: null,
      };
    }
  } else if (v.action === "open-private") {
    if (phase !== "public")
      throw new ApiError("Chỉ chuyển private khi public đang mở.", 409);
    future(v.endAt);
    next = applyPrivateTransition(
      {
        ...c,
        timingVersion: 1,
        privateAt: now,
        endAt: v.endAt,
        privatePolicy: {
          lockPublic: v.lockPublic,
          revokeChatbot: v.revokeChatbot,
        },
      },
      now,
    );
  } else if (v.action === "practice-open") {
    if (phase !== "ended")
      throw new ApiError(
        "Chỉ mở luyện tập tiếp sau khi vòng đã kết thúc.",
        409,
      );
    future(v.endAt);
    if (v.chatbotEnabled) future(v.chatbotUntil);
    next = {
      ...next,
      practice: { startAt: now, endAt: v.endAt },
      submissionAccess: {
        public: { visible: v.publicVisible, enabled: true },
        private: { visible: v.privateVisible, enabled: true },
      },
      chatbotAllowed: v.chatbotEnabled,
      chatbotUntil: v.chatbotEnabled ? v.chatbotUntil : null,
      notebookAllowed: v.notebookEnabled,
      chatEpoch: (c.chatEpoch ?? 0) + 1,
    };
  } else if (v.action === "practice-close") {
    if (phase !== "practice")
      throw new ApiError("Không có lượt luyện tập đang mở.", 409);
    next.practice = { ...c.practice!, endAt: now };
    next.chatEpoch = (c.chatEpoch ?? 0) + 1;
  } else if (v.action === "submission-access") {
    next.submissionAccess = {
      public: { ...submissionPolicy(c, "public") },
      private: { ...submissionPolicy(c, "private") },
      [v.split]: { visible: v.visible, enabled: v.enabled },
    };
  } else if (v.action === "chatbot-access") {
    if (v.enabled && !active)
      throw new ApiError(
        "Mở vòng hoặc luyện tập tiếp trước khi cấp chatbot.",
        409,
      );
    if (v.enabled) future(v.until);
    next.chatbotAllowed = v.enabled;
    next.chatbotUntil = v.enabled ? v.until : null;
    next.chatEpoch = (c.chatEpoch ?? 0) + 1;
  } else if (v.action === "notebook-access") next.notebookAllowed = v.enabled;
  return { ...next, revision: (c.revision ?? 0) + 1 };
}

// The phase is checked again with Redis TIME, including transitions racing the form submit.
export const CONTROL_ROUND_SCRIPT =
  ROUND_POLICY_LUA +
  `
local cached=redis.call('GET',KEYS[2]);if cached then if cached==ARGV[1] then return 'ok' else return 'nonce' end end
local now=arena_now();local c=arena_round(KEYS[1],now);if not c or c.id~=ARGV[2] then return 'run' end
if (c.revision or 0)~=tonumber(ARGV[3]) or arena_phase(c,now)~=ARGV[4] then return 'conflict' end
local next=cjson.decode(ARGV[5]);local action=ARGV[6]
if action=='timing' or action=='open-private' or action=='practice-open' then
 local e;if next.practice then e=arena_value(next.practice.endAt) else e=arena_value(next.endAt) end
 if e and e<=now then return 'conflict' end
end
if action=='timing' and arena_phase(c,now)=='public' then local p=arena_private(next);if p and p<=now then return 'conflict' end end
if (action=='chatbot-access' or action=='practice-open') and next.chatbotAllowed and arena_value(next.chatbotUntil) and next.chatbotUntil<=now then return 'conflict' end
redis.call('SET',KEYS[1],ARGV[5]);redis.call('SET',KEYS[2],ARGV[1],'EX',604800);return 'ok'
`;
