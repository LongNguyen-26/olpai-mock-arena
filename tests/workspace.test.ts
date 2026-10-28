import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  chatbotOpen,
  defaultTemplate,
  driveFileId,
  emptySession,
  ChatLimitError,
  exhaustChatSession,
  estimatedCost,
  meter,
  outputBudget,
  templateSchema,
  workspaceView,
  workspaceAccess,
  type Workspace,
} from "../src/lib/workspace-domain";
import {
  decryptSecret,
  encryptSecret,
  matchesSecret,
} from "../src/lib/workspace-crypto";
import { podOrigin, Runpod, RunpodError } from "../src/lib/runpod";
import type { Contest } from "../src/lib/types";
import { hasService, servicesOverlap } from "../src/lib/workspace-options";
test("chatbot closes at private boundary, early private, end and round reset", () => {
  const c: Contest = {
    id: "run",
    title: "QA",
    startAt: 1000,
    forcedEndAt: null,
    publicSeconds: 18000,
    privateSeconds: 3600,
    publicLimit: 20,
    privateLimit: 5,
    createdAt: 0,
  };
  assert.equal(chatbotOpen({ runId: "run" }, c, 999), false);
  assert.equal(chatbotOpen({ runId: "run" }, c, 1000), true);
  assert.equal(chatbotOpen({ runId: "run" }, c, 18001000), false);
  assert.equal(
    chatbotOpen({ runId: "run" }, { ...c, privateAt: 2000 }, 2000),
    false,
  );
  assert.equal(chatbotOpen({ runId: "old" }, c, 1000), false);
  assert.equal(
    chatbotOpen({ runId: "run" }, { ...c, forcedEndAt: 2000 }, 2000),
    false,
  );
});
test("service links follow phase, registration and actual service readiness", () => {
  const c = {
    id: "run",
    startAt: 1000,
    publicSeconds: 1,
    privateSeconds: 1,
    forcedEndAt: null,
  } as Contest;
  const w = {
    runId: "run",
    status: "running",
    health: { jupyter: false, llm: false },
  } as Workspace;
  assert.equal(workspaceAccess(w, c, 1500).notebookEnabled, false);
  w.health = { ...w.health!, jupyter: true, llm: true };
  assert.equal(workspaceAccess(w, c, 1500).notebookEnabled, true);
  assert.equal(workspaceAccess(w, c, 1500).chatbotEnabled, true);
  assert.equal(workspaceAccess(w, c, 2500).notebookEnabled, true);
  assert.equal(workspaceAccess(w, c, 2500).chatbotEnabled, false);
  assert.equal(workspaceAccess(w, c, 3500).notebookEnabled, false);
  assert.equal(
    workspaceAccess(w, c, 1500, false, false).notebookEnabled,
    false,
  );
  w.runId = "old";
  assert.equal(workspaceAccess(w, c, 1500).chatbotEnabled, false);
});

test("single-service Pods never advertise access to a disabled service", () => {
  const c = {
    id: "run",
    startAt: 1000,
    publicSeconds: 100,
    privateSeconds: 10,
    forcedEndAt: null,
  } as Contest;
  const w = {
    runId: "run",
    status: "running",
    health: { jupyter: true, llm: true },
    services: "llm",
  } as Workspace;
  assert.equal(workspaceAccess(w, c, 2000).notebookEnabled, false);
  assert.equal(workspaceAccess(w, c, 2000).chatbotEnabled, true);
  w.services = "jupyter";
  assert.equal(workspaceAccess(w, c, 2000).notebookEnabled, true);
  assert.equal(workspaceAccess(w, c, 2000).chatbotEnabled, false);
  assert.equal(chatbotOpen(w, c, 2000), false);
  assert.equal(hasService({}, "jupyter"), true);
  assert.equal(servicesOverlap("llm", "jupyter"), false);
  assert.equal(servicesOverlap("both", "llm"), true);
});

test("LLM-only Pod exposes its agent without a Jupyter port", async () => {
  const rp = new Runpod("fake", (async (_url, init) => {
    const input = JSON.parse(String(init?.body)).variables.input;
    assert.equal(input.ports, "8000/http");
    assert.ok(
      !input.env.some((v: { key: string }) => v.key === "JUPYTER_TOKEN"),
    );
    return Response.json({
      data: {
        podFindAndDeployOnDemand: {
          id: "testpod123",
          name: "llm",
          desiredStatus: "RUNNING",
        },
      },
    });
  }) as typeof fetch);
  await rp.create("llm", defaultTemplate, { ARENA_WORKSPACE_SERVICES: "llm" });
});

test("token budget includes repeated prompt/history and bounds the generated maximum", () => {
  const t = { ...defaultTemplate };
  assert.equal(outputBudget(t, emptySession(), 1800), 200);
  assert.equal(
    outputBudget(
      t,
      { messages: [], inputTokens: 500, outputTokens: 1000 },
      400,
    ),
    100,
  );
  assert.throws(() => outputBudget(t, emptySession(), 1801), /Input/);
  assert.throws(
    () =>
      outputBudget(
        t,
        { messages: [], inputTokens: 1500, outputTokens: 400 },
        100,
      ),
    /hết/,
  );
  assert.throws(() => outputBudget(t, emptySession(), NaN));
});
test("oversized turns remain in history and permanently exhaust only that session", () => {
  const original = { ...emptySession(), inputTokens: 30, outputTokens: 10 };
  for (const [prompt, reason] of [
    [1801, "input"],
    [1960, "input"],
  ] as const) {
    const error = new ChatLimitError(reason, "Input vượt giới hạn.");
    const closed = exhaustChatSession(
      defaultTemplate,
      original,
      "long prompt",
      "request",
      prompt,
      error,
    );
    assert.deepEqual(closed.messages, [
      { role: "user", content: "long prompt" },
    ]);
    assert.equal(closed.inputTokens + closed.outputTokens, 2000);
    assert.equal(closed.lastRequestId, "request");
    assert.equal(closed.exhausted?.promptTokens, prompt);
    assert.throws(
      () => outputBudget(defaultTemplate, closed, 1),
      /hết ngân sách/,
    );
  }
  assert.deepEqual(original.messages, []);
  assert.equal(outputBudget(defaultTemplate, emptySession(), 20), 1024);
  assert.throws(
    () => outputBudget(defaultTemplate, emptySession(), NaN),
    (e) => !(e instanceof ChatLimitError),
  );
  assert.throws(
    () => outputBudget(defaultTemplate, { ...original, inputTokens: 1990 }, 1),
    (e) => e instanceof ChatLimitError && e.reason === "session",
  );
});
test("cost ledger preserves billed intervals across stop/start and strips all secrets", () => {
  const w = {
    id: "w",
    secret: "encrypted-secret",
    jupyterSecret: "encrypted-jupyter",
    ownerId: "admin",
    accruedUsd: 1,
    meterAt: 1000,
    meterRate: 0.6,
  } as Workspace;
  const stopped = meter(w, 3601000, "stopped", 0.02);
  assert.equal(stopped.accruedUsd, 1.6);
  assert.equal(estimatedCost(stopped, 7201000), 1.62);
  const terminated = meter(stopped, 7201000, "terminated", 0);
  assert.equal(estimatedCost(terminated, 999999999), 1.62);
  assert.equal(estimatedCost(w, 0), 1);
  const safe = workspaceView(w, 1000);
  assert.equal("secret" in safe, false);
  assert.equal("jupyterSecret" in safe, false);
  assert.equal("ownerId" in safe, false);
});
test("Runpod credentials use authenticated encryption; malformed/tampered values fail", () => {
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const encrypted = encryptSecret("test-key-never-a-real-credential");
  assert.equal(decryptSecret(encrypted), "test-key-never-a-real-credential");
  assert.ok(!encrypted.includes("test-key"));
  const fields = encrypted.split(".");
  fields[1] = randomBytes(16).toString("base64url");
  assert.throws(() => decryptSecret(fields.join(".")));
  assert.equal(matchesSecret("Bearer abc", "abc"), true);
  assert.equal(matchesSecret(null, "abc"), false);
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY = "bad";
  assert.throws(() => encryptSecret("x"));
});
test("Drive IDs and Pod origins cannot redirect credentials to arbitrary hosts", () => {
  assert.equal(
    driveFileId("https://drive.google.com/file/d/abcde12345/view"),
    "abcde12345",
  );
  assert.equal(
    driveFileId("https://drive.google.com/uc?id=abcde12345"),
    "abcde12345",
  );
  assert.throws(() => driveFileId("https://evil.test/file/d/abcde12345/view"));
  assert.throws(() =>
    driveFileId("http://drive.google.com/file/d/abcde12345/view"),
  );
  assert.throws(() => podOrigin("evil.test/path", 8000));
  assert.equal(
    podOrigin("testpod123", 8888),
    "https://testpod123-8888.proxy.runpod.net",
  );
});
test("template validates resource and token limits", () => {
  assert.equal(
    templateSchema.safeParse({
      ...defaultTemplate,
      imageName: "nguyenlong26/olpai-workspace:2026.10.27",
    }).success,
    true,
  );
  assert.equal(templateSchema.safeParse(defaultTemplate).success, false);
  assert.equal(
    templateSchema.safeParse({ ...defaultTemplate, imageName: "image;command" })
      .success,
    false,
  );
  assert.equal(
    templateSchema.safeParse({
      ...defaultTemplate,
      imageName: "image:v1",
      inputTokenLimit: 2000,
    }).success,
    false,
  );
});
test("Runpod uses SDK GraphQL contract and never retries a timed-out create", async () => {
  let calls = 0;
  const transport = (async (url, options) => {
    calls++;
    assert.equal(url, "https://api.runpod.io/graphql");
    const request = JSON.parse(options?.body as string);
    assert.match(request.query, /podFindAndDeployOnDemand\(input: \$input\)/);
    const body = request.variables.input;
    assert.equal(body.gpuCount, 1);
    assert.equal(body.minCudaVersion, "12.8");
    assert.equal(body.allowedCudaVersions, undefined);
    assert.equal(body.gpuTypeId, "NVIDIA A40");
    assert.equal(body.minMemoryInGb, defaultTemplate.minRAMPerGPU);
    assert.equal(body.minVcpuCount, defaultTemplate.minVCPUPerGPU);
    assert.equal(body.ports, "8888/http,8000/http");
    assert.deepEqual(body.env, [
      { key: "TEST_TOKEN", value: "fake-agent-token" },
    ]);
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer fake-test-key",
    );
    throw new Error("sensitive provider payload");
  }) as typeof fetch;
  await assert.rejects(
    () =>
      new Runpod("fake-test-key", transport).create(
        "allocation",
        defaultTemplate,
        { TEST_TOKEN: "fake-agent-token" },
      ),
    (e: unknown) =>
      e instanceof RunpodError &&
      e.uncertain &&
      !e.message.includes("sensitive"),
  );
  assert.equal(calls, 1);
});
test("Runpod accepts GraphQL control responses and refuses to leak provider error text", async () => {
  const empty = new Runpod("fake", (async (_url, options) => {
    const query = JSON.parse(options?.body as string).query as string;
    return Response.json({
      data: query.includes("ArenaTerminate")
        ? { podTerminate: null }
        : { podStop: { id: "testpod123", desiredStatus: "EXITED" } },
    });
  }) as typeof fetch);
  await empty.stop("testpod123");
  await empty.terminate("testpod123");
  const denied = new Runpod(
    "fake",
    (async () =>
      new Response("secret env in provider body", {
        status: 401,
      })) as typeof fetch,
  );
  await assert.rejects(
    () => denied.list(),
    (e: unknown) =>
      e instanceof RunpodError &&
      !e.uncertain &&
      !e.message.includes("secret env"),
  );
});

test("unconfirmed allocations never display phantom costs, including old records", () => {
  const w = {
    podId: null,
    status: "reconciling",
    meterAt: 0,
    meterRate: 0.35,
    accruedUsd: 2,
  } as Workspace;
  const view = workspaceView(w, 3600000);
  assert.equal(view.estimatedUsd, 0);
  assert.equal(view.meterRate, 0);
  assert.equal(view.accruedUsd, 0);
});

test("Runpod HTTP 200 SUPPLY_CONSTRAINT is rejected; unknown mutation errors remain uncertain", async () => {
  for (const [code, uncertain] of [
    ["SUPPLY_CONSTRAINT", false],
    ["INTERNAL_SERVER_ERROR", true],
  ] as const) {
    const rp = new Runpod("fake", (async () =>
      Response.json({
        data: { podFindAndDeployOnDemand: null },
        errors: [{ message: "private-token", extensions: { code } }],
      })) as typeof fetch);
    await assert.rejects(
      () => rp.create("test", defaultTemplate, {}),
      (e: unknown) =>
        e instanceof RunpodError &&
        e.uncertain === uncertain &&
        (uncertain || e.message.includes("GPU trống")) &&
        !e.message.includes("private-token"),
    );
  }
});

test("Runpod query failures cannot be mistaken for an empty Pod list", async () => {
  const rp = new Runpod("fake", (async () =>
    Response.json({
      errors: [{ message: "secret", extensions: { code: "FORBIDDEN" } }],
    })) as typeof fetch);
  await assert.rejects(
    () => rp.list(),
    (e: unknown) =>
      e instanceof RunpodError && e.status === 403 && !e.uncertain,
  );
  const timeout = new Runpod("fake", (async () => {
    throw new Error("network");
  }) as typeof fetch);
  await assert.rejects(
    () => timeout.list(),
    (e: unknown) => e instanceof RunpodError && !e.uncertain,
  );
});

test("Runpod validation errors identify safe field names without echoing secrets", async () => {
  const provider = new Runpod(
    "real-looking-secret",
    (async () =>
      new Response(
        JSON.stringify({
          errors: [
            {
              path: ["allowedCudaVersions", 3],
              message: "secret from provider body",
            },
            { path: ["env", "TOKEN"], message: "real-looking-secret" },
          ],
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch,
  );
  await assert.rejects(
    () => provider.create("test", defaultTemplate, {}),
    (e: unknown) =>
      e instanceof RunpodError &&
      !e.uncertain &&
      e.message.includes("allowedCudaVersions") &&
      !/secret|TOKEN|env/.test(e.message),
  );
});
