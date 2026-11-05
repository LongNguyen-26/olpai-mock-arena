import test from "node:test";
import assert from "node:assert/strict";
import { groqComplete, groqModels, GroqError, groqPromptReservation, isGroqChatModel, fitGroqHistory } from "../src/lib/groq";

test("Groq discovers active supported text models and rejects audio/guard/compound models", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.groq.com/openai/v1/models");
      assert.equal(init?.method, "GET");
      return Response.json({ data: [
        { id: "openai/gpt-oss-120b", context_window: 131072 },
        { id: "whisper-large-v3", context_window: 448 },
        { id: "openai/gpt-oss-safeguard-20b", context_window: 131072 },
        { id: "llama-3.3-70b-versatile", context_window: 131072, active: false },
        { id: "groq/compound", context_window: 131072 },
      ] });
    };
    assert.deepEqual((await groqModels("fake-key-for-unit-test")).map(m => m.id), ["openai/gpt-oss-120b"]);
    assert.equal(isGroqChatModel("openai/gpt-oss-120b/../../other"), false);
  } finally { globalThis.fetch = original; }
});
test("Groq sends only text chat parameters and reconciles provider token usage", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_completion_tokens, 100);
      assert.equal(body.stream, false);
      assert.equal(body.tools, undefined);
      return Response.json({ id: "safe-provider-id", choices: [{ message: { content: "Xin chào" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 17, completion_tokens: 26 } });
    };
    const messages = [{ role: "user" as const, content: "Xin chào 👋" }];
    const r = await groqComplete("fake-key-for-unit-test", "openai/gpt-oss-20b", messages, 100);
    assert.equal(r.inputTokens, 17); assert.equal(r.outputTokens, 26);
    assert.ok(groqPromptReservation(messages) >= Buffer.byteLength(messages[0].content));
  } finally { globalThis.fetch = original; }
});
test("Groq never includes upstream bodies/secrets in errors; uncertain responses cannot be retried blindly", async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, kind] of [[401,"rejected"],[403,"rejected"],[429,"rate_limit"],[503,"uncertain"]] as const) {
      globalThis.fetch = async () => new Response("secret-provider-body", { status, headers: { "retry-after": "12" } });
      await assert.rejects(() => groqComplete("fake-key", "openai/gpt-oss-20b", [], 20), (e: unknown) => {
        assert.ok(e instanceof GroqError); assert.equal(e.kind, kind); assert.ok(!e.message.includes("secret-provider-body"));
        if (status === 429) assert.equal(e.retryAfter, 12);
        return true;
      });
    }
    globalThis.fetch = async () => Response.json({ choices: [], usage: null });
    await assert.rejects(() => groqComplete("fake-key", "openai/gpt-oss-20b", [], 20), (e: unknown) => e instanceof GroqError && e.kind === "uncertain");
  } finally { globalThis.fetch = original; }
});

test("Groq trims completed old turns while preserving the visible transcript and last prompt", () => {
  const transcript = [{role:"user" as const,content:"a".repeat(1000)},{role:"assistant" as const,content:"b".repeat(1000)},{role:"user" as const,content:"new prompt"}];
  assert.deepEqual(fitGroqHistory(transcript,500),[transcript[2]]);
  assert.equal(transcript.length,3);
});
