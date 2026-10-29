import { test } from "node:test";
import assert from "node:assert/strict";
import { Runpod } from "../src/lib/runpod";

const event = (line: string, source = "system") =>
  `data: ${JSON.stringify({ source, line, ts: "2026-10-29T00:53:22Z" })}\n\n`;

test("startup diagnostics recognize split SSE GPU-reset events without returning logs", async () => {
  const body = event(
    "error creating container: nvidia-smi: failed to parse ([GPU requires reset]) secret-env-value",
  );
  let cancelled = false;
  const provider = new Runpod("api-secret", (async (url, init) => {
    assert.equal(
      String(url),
      "https://api.runpod.io/v2/pods/qa123/logs?source=system&tail=20",
    );
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer api-secret",
    );
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body.slice(0, 85)));
          controller.enqueue(new TextEncoder().encode(body.slice(85)));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  }) as typeof fetch);
  assert.equal(await provider.startupFailure("qa123"), "gpu-reset");
  assert.equal(cancelled, true);
});

test("unavailable logs and normal image/model startup are not container failures", async () => {
  for (const response of [
    new Response("private provider error", { status: 403 }),
    new Response(event("Pulling image") + event("Downloading model")),
    new Response(
      event("error creating container: [GPU requires reset]", "container"),
    ),
    new Response("data: malformed secret\n\n"),
  ]) {
    const provider = new Runpod("fake", (async () => response) as typeof fetch);
    assert.equal(await provider.startupFailure("qa123"), null);
  }
});

test("startup diagnostics bound an endless log stream and recognize other container errors", async () => {
  const provider = new Runpod(
    "fake",
    (async () =>
      new Response(
        event(
          "error creating container: image entrypoint missing private-secret",
        ),
      )) as typeof fetch,
  );
  assert.equal(await provider.startupFailure("qa123"), "container");

  let reads = 0,
    cancelled = false;
  const endless = new Runpod(
    "fake",
    (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            reads++;
            controller.enqueue(new TextEncoder().encode("x".repeat(8192)));
          },
          cancel() {
            cancelled = true;
          },
        }),
      )) as typeof fetch,
  );
  assert.equal(await endless.startupFailure("qa123"), null);
  assert.ok(reads <= 5);
  assert.equal(cancelled, true);
});
