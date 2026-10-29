import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  defaultTemplate,
  emptySession,
  outputBudget,
  chatContextWindow,
  chatParallel,
  workspaceView,
  templateSchema,
  type Workspace,
} from "../src/lib/workspace-domain";
import {
  chatLimitSummary,
  chatUsageLog,
  isChatClosed,
} from "../src/lib/chat-limits";
import { validateTemplateSave } from "../src/lib/workspace-templates";
import { Runpod } from "../src/lib/runpod";

test("concurrent inference preserves legacy allocations and validates bounded capacity", () => {
  const { llmParallel: _newDefault, ...legacy } = defaultTemplate;
  assert.equal(chatParallel(legacy), 1);
  assert.equal(chatParallel({ ...defaultTemplate, llmParallel: 4 }), 4);
  for (const capacity of [1, 2, 4, 8] as const) {
    const t = {
      ...defaultTemplate,
      imageName: "example/image",
      llmParallel: capacity,
    };
    assert.ok(templateSchema.safeParse(t).success);
    assert.equal(chatContextWindow(t), chatContextWindow(legacy));
  }
  for (const capacity of [0, 3, 9, 1.5])
    assert.equal(
      templateSchema.safeParse({
        ...defaultTemplate,
        imageName: "example/image",
        llmParallel: capacity,
      }).success,
      false,
    );
});

test("total session ceiling applies to both session and per-turn input/output modes", () => {
  const t = {
    ...defaultTemplate,
    sessionTokenLimit: 4000,
    tokenLimitMode: "session" as const,
  };
  const s = { ...emptySession(), inputTokens: 1700, outputTokens: 1000 };
  assert.equal(outputBudget(t, s, 100), 24);
  assert.throws(() => outputBudget(t, s, 101), /Input cộng dồn/);
  assert.throws(
    () => outputBudget(t, { ...s, outputTokens: 1024 }, 10),
    /Output/,
  );
  const turn = { ...t, tokenLimitMode: "turn" as const };
  const spent = { ...s, inputTokens: 50000, outputTokens: 50000 };
  assert.throws(() => outputBudget(turn, spent, 100), /hết ngân sách/);
  assert.equal(
    outputBudget(
      turn,
      { ...emptySession(), inputTokens: 1800, outputTokens: 1500 },
      100,
    ),
    600,
  );
  assert.equal(isChatClosed(turn, spent), true);
  assert.equal(isChatClosed(t, { ...s, inputTokens: 1800 }), true);
  assert.equal(chatContextWindow(turn), 1800 + 1024 + 128);
  assert.equal(chatContextWindow(defaultTemplate), 2128);
  assert.ok(
    templateSchema.safeParse({
      ...turn,
      imageName: "example/image",
      inputTokenLimit: 8192,
    }).success,
  );
});
test("footer and usage logs use current mode and current input/output settings", () => {
  const s = { ...emptySession(), inputTokens: 40, outputTokens: 20 };
  assert.match(chatLimitSummary(defaultTemplate, s), /1800\/lượt.*1024\/lượt/);
  const t = {
    ...defaultTemplate,
    tokenLimitMode: "session" as const,
    inputTokenLimit: 2500,
    outputTokenLimit: 1500,
  };
  assert.match(chatUsageLog(t, s), /40\/2500.*20\/1500/);
  assert.match(
    chatUsageLog({ ...t, tokenLimitMode: "turn" }, s),
    /Input ≤ 2500.*Output ≤ 1500.*vẫn cộng dồn/,
  );
});
test("hidden metrics are removed from student DTOs and retained for administrators", () => {
  const w = {
    template: defaultTemplate,
    health: { gpu: "secret telemetry", llm: true },
    metricsVisible: false,
    uptimeSeconds: 123,
    uptimeObservedAt: 456,
  } as Workspace;
  const view = workspaceView(w, 1000, false);
  assert.equal(view.health?.gpu, undefined);
  assert.equal(view.uptimeSeconds, undefined);
  assert.equal(view.health?.llm, true);
  assert.equal(workspaceView(w, 1000, true).health?.gpu, "secret telemetry");
  assert.equal(w.health?.gpu, "secret telemetry");
});
test("template overwrites require confirmation and a current revision; normalized duplicate names are refused", () => {
  const revision = randomUUID(),
    old = { ...defaultTemplate, revision };
  const saved = { [old.id]: old };
  assert.throws(() => validateTemplateSave(old, saved, false), /xác nhận/);
  assert.throws(
    () => validateTemplateSave(old, saved, true, randomUUID()),
    /cửa sổ khác/,
  );
  validateTemplateSave({ ...old, name: "Updated" }, saved, true, revision);
  assert.throws(
    () =>
      validateTemplateSave(
        { ...old, id: randomUUID(), name: ` ${old.name.toUpperCase()} ` },
        saved,
        false,
      ),
    /Tên template/,
  );
  validateTemplateSave(
    { ...old, id: randomUUID(), name: "A new template" },
    saved,
    false,
  );
});
test("GPU resources come from Runpod's selected GPU/cloud offer, not VRAM", async () => {
  const rp = new Runpod("fake", (async (_url, init) => {
    const value = JSON.parse(String(init?.body));
    assert.equal(value.variables.gpu.id, "NVIDIA A40");
    assert.equal(value.variables.offer.secureCloud, false);
    assert.equal(value.variables.offer.gpuCount, 1);
    return Response.json({
      data: {
        gpuTypes: [
          {
            id: "NVIDIA A40",
            lowestPrice: { minMemory: 50, minVcpu: 9, stockStatus: "Medium" },
          },
        ],
      },
    });
  }) as typeof fetch);
  assert.deepEqual(await rp.resources("NVIDIA A40", "COMMUNITY"), {
    minRAMPerGPU: 50,
    minVCPUPerGPU: 9,
    stockStatus: "Medium",
  });
});
