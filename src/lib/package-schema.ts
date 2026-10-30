import { z } from "zod";

const taskId = z.enum(["1", "2", "3"]);
const objectKey = z
  .string()
  .min(1)
  .refine(
    (s) =>
      s.startsWith("packages/") &&
      !s.includes("\\") &&
      !s.split("/").some((p) => p === ".." || p === "."),
    "Package object key required",
  );
const pair = z.object({ public: objectKey, private: objectKey });
const spec = z
  .object({
    kind: z.enum(["pinball", "aspect-f1", "pump-f1"]),
    maxScore: z.number().positive().max(100),
    baseline: z.number().finite(),
    reference: z.number().finite(),
  })
  .refine(
    (s) =>
      s.kind === "pinball"
        ? s.reference < s.baseline
        : s.reference > s.baseline,
    "Invalid score thresholds",
  );
const directSpec = z.object({
  kind: z.enum(["scaled-mae", "multilabel-f1", "trimap-iou", "generation-chrf"]),
  maxScore: z.literal(100),
});
export const packageSchema = z
  .object({
    version: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    title: z.string().min(3).max(100),
    statement: z.string().default(""),
    tasks: z
      .array(
        z.object({
          id: taskId,
          title: z.string().min(1),
          content: z.string().min(1),
          maxScore: z.number().positive().max(100).optional(),
          columns: z.array(z.string().min(1)).min(2).optional(),
          maxSubmissionBytes: z.number().int().min(1).max(4_000_000).optional(),
        }),
      )
      .min(2)
      .max(3),
    assets: z.array(
      z.object({
        key: objectKey,
        name: z
          .string()
          .min(1)
          .refine((s) => !/[\\/]/.test(s)),
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        phase: z.enum(["public", "private"]),
        description: z.string().default(""),
        driveUrl: z
          .string()
          .url()
          .refine((s) => new URL(s).hostname === "drive.google.com")
          .optional(),
        task: taskId.optional(),
        workspaceLayout: z.literal("task-root").optional(),
      }),
    ),
    judges: z.object({ "1": pair, "2": pair, "3": pair.optional() }),
    judgeSpecs: z
      .object({
        "1": spec.optional(),
        "2": spec.optional(),
        "3": spec.optional(),
      })
      .optional(),
    directJudgeSpecs: z.object({
      "1": directSpec.optional(),
      "2": directSpec.optional(),
      "3": directSpec.optional(),
    }).optional(),
  })
  .superRefine((pkg, ctx) => {
    const ids = pkg.tasks.map((t) => t.id);
    if (
      new Set(ids).size !== ids.length ||
      !ids.includes("1") ||
      !ids.includes("2") ||
      ids.includes("3") !== !!pkg.judges["3"]
    )
      ctx.addIssue({
        code: "custom",
        message: "Task IDs and judge keys must match exactly.",
        path: ["tasks"],
      });
    for (const t of pkg.tasks) {
      const s = pkg.judgeSpecs?.[t.id];
      const direct = pkg.directJudgeSpecs?.[t.id];
      if (direct && (s || direct.maxScore !== t.maxScore ||
        t.columns?.join(",") !== ({ "scaled-mae": "id,prediction", "multilabel-f1": "id,labels", "trimap-iou": "id,pet_rle,border_rle", "generation-chrf": "id,prediction" }[direct.kind])))
        ctx.addIssue({ code: "custom", message: "Task display must match the direct judge.", path: ["directJudgeSpecs", t.id] });
      if (
        s &&
        (s.maxScore !== t.maxScore ||
          !t.columns ||
          t.columns.join(",") !==
            (s.kind === "pinball"
              ? "id,p50,p90"
              : s.kind === "aspect-f1"
                ? "id,giao_hang,chat_luong,gia,dong_goi,cskh"
                : "id,label"))
      )
        ctx.addIssue({
          code: "custom",
          message: "Task display must match the configured judge.",
          path: ["judgeSpecs", t.id],
        });
      if (t.id === "3" && !s && !direct)
        ctx.addIssue({
          code: "custom",
          message: "Task 3 requires a judge specification.",
          path: ["judgeSpecs", "3"],
        });
    }
    if (
      pkg.assets.some((a) => a.task && !ids.includes(a.task)) ||
      new Set(pkg.assets.map((a) => a.key)).size !== pkg.assets.length ||
      new Set(pkg.assets.map((a) => a.name)).size !== pkg.assets.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Assets require unique keys/names and valid tasks.",
        path: ["assets"],
      });
  });
