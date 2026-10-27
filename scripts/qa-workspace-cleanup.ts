import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { db } from "../src/lib/db";
async function main() {
  const fixture = JSON.parse(await readFile(".local/gpu-qa.json", "utf8"));
  assert.match(fixture.namespace, /^arena:qa:gpu:[0-9a-f-]{36}$/);
  const prefix = fixture.namespace + ":";
  let cursor = "0",
    removed = 0;
  do {
    const [next, keys] = await db().scan(cursor, {
      match: prefix + "*",
      count: 100,
    });
    cursor = String(next);
    if (keys.length) {
      assert.ok(keys.every((k) => k.startsWith(prefix)));
      await db().del(...keys);
      removed += keys.length;
    }
  } while (cursor !== "0");
  await unlink(".local/gpu-qa.json");
  console.log(
    `Removed ${removed} QA keys and local fixture; production untouched.`,
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Cleanup failed");
  process.exitCode = 1;
});
