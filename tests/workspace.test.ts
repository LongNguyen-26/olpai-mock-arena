import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  chatbotOpen,
  defaultTemplate,
  driveFileId,
  emptySession,
  estimatedCost,
  meter,
  outputBudget,
  templateSchema,
  workspaceView,
  type Workspace,
} from "../src/lib/workspace-domain";
import {
  decryptSecret,
  encryptSecret,
  matchesSecret,
} from "../src/lib/workspace-crypto";
import { podOrigin, Runpod, RunpodError } from "../src/lib/runpod";
import type { Contest } from "../src/lib/types";
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
test("Runpod creates exactly one GPU, exposes only required ports and never retries a timed-out create", async () => {
  let calls = 0;
  const transport = (async (url, options) => {
    calls++;
    assert.equal(url, "https://rest.runpod.io/v1/pods");
    const body = JSON.parse(options?.body as string);
    assert.equal(body.gpuCount, 1);
    assert.equal(body.interruptible, false);
    assert.deepEqual(body.ports, ["8888/http", "8000/http"]);
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
        {},
      ),
    (e: unknown) =>
      e instanceof RunpodError &&
      e.uncertain &&
      !e.message.includes("sensitive"),
  );
  assert.equal(calls, 1);
});
test("Runpod accepts empty stop responses and refuses to leak provider error text", async () => {
  const empty = new Runpod(
    "fake",
    (async () => new Response(null, { status: 200 })) as typeof fetch,
  );
  await empty.stop("testpod123");
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
