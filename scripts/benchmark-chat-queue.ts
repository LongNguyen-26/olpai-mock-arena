/** Explicit load test against an existing group; never provisions, drains or stops Pods. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

async function main() {
  const arg = (name: string) =>
    process.argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.slice(name.length + 3);
  const total = Number(arg("requests") ?? 14),
    groupId = arg("group"),
    file = arg("accounts");
  const base = arg("base") ?? "https://olpai-mock-arena.vercel.app";
  assert.ok(
    [14, 28].includes(total) && groupId && file,
    "Use --requests=14|28 --group=UUID --accounts=.local/accounts.json",
  );
  assert.ok(
    [
      "https://olpai-mock-arena.vercel.app",
      "https://olpaiarena.cyou",
      "https://www.olpaiarena.cyou",
    ].includes(base) || /^http:\/\/localhost:\d+$/.test(base),
    "Use this Arena's known URL.",
  );
  if (!process.argv.includes("--execute")) {
    console.log(
      `Dry run: ${total} prompts, 14 accounts, existing group ${groupId}. Add --execute to run inference.`,
    );
    return;
  }
  const accounts: { username: string; password: string }[] = JSON.parse(
    await readFile(file, "utf8"),
  );
  assert.ok(
    accounts.length >= 14,
    "Provide 14 contestant accounts, two per team where applicable.",
  );
  const cookies: string[] = [];
  const request = async (path: string, cookie: string, body?: unknown) => {
    const response = await fetch(`${base}/api/workspace/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
    return value;
  };
  try {
    for (const account of accounts.slice(0, 14)) {
      const response = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify(account),
      });
      assert.equal(response.status, 200, "Benchmark account login failed");
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      cookies.push(cookie);
    }
    const prompt = arg("prompt-file")
      ? await readFile(arg("prompt-file")!, "utf8")
      : "Viết một hàm Python tìm giá trị lớn thứ hai khác nhau trong danh sách số nguyên, giải thích ngắn và cho ví dụ.";
    const results = await Promise.all(
      Array.from({ length: total }, async (_, index) => {
        const cookie = cookies[index % 14],
          session = randomUUID(),
          requestId = randomUUID(),
          start = Date.now();
        const path = `chat?groupId=${groupId}&session=${session}`;
        try {
          const initial = await request(path, cookie);
          await request("chat", cookie, {
            groupId,
            session,
            requestId,
            runId: initial.runId,
            content: prompt,
          });
          const acceptedMs = Date.now() - start;
          while (Date.now() - start < 3600000) {
            await delay(2000);
            const state = await request(path, cookie);
            if (state.runId !== initial.runId) throw new Error("Round reset");
            if (state.session.error) throw new Error(state.session.error);
            if (
              !state.session.pending &&
              state.session.lastRequestId === requestId
            )
              return {
                index,
                requestId,
                acceptedMs,
                completedMs: Date.now() - start,
                inputTokens: state.session.inputTokens,
                outputTokens: state.session.outputTokens,
                ok: true,
              };
          }
          throw new Error(
            "Benchmark timeout; accepted request remains on server",
          );
        } catch (e) {
          return {
            index,
            requestId,
            ok: false,
            elapsedMs: Date.now() - start,
            error: e instanceof Error ? e.message : "Failed",
          };
        }
      }),
    );
    await mkdir(".local/benchmarks", { recursive: true });
    const output = `.local/benchmarks/chat-${total}-${Date.now()}.json`;
    await writeFile(
      output,
      JSON.stringify({ base, groupId, requests: total, results }, null, 2),
    );
    console.log(
      JSON.stringify({
        output,
        completed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        maxCompletedMs: Math.max(
          0,
          ...results.flatMap((r) =>
            "completedMs" in r ? [r.completedMs!] : [],
          ),
        ),
      }),
    );
  } finally {
    await Promise.allSettled(
      cookies.map((cookie) =>
        fetch(`${base}/api/auth/logout`, {
          method: "POST",
          headers: { Cookie: cookie, Origin: base },
        }),
      ),
    );
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Benchmark failed");
  process.exitCode = 1;
});
