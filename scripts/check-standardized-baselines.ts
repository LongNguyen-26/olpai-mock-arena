/** Local CSV validation with the web judges; no network, training or state writes. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { gunzipSync } from "node:zlib";
import { packageSchema } from "../src/lib/package-schema";
import { judgeCV, judgeQA } from "../src/lib/judge";
import { judgeArena02 } from "../src/lib/judge-arena02";

async function main() {
  for (const arena of [1, 2]) {
    const root = `../statements/Arena_0${arena}/web_ready/release_20261028`;
    const pkg = packageSchema.parse(
      JSON.parse(
        await readFile(join(root, "internal/package-config.json"), "utf8"),
      ),
    );
    for (const task of pkg.tasks)
      for (const split of ["public", "private"] as const) {
        const judge = pkg.judges[task.id]![split];
        const truth = JSON.parse(
          gunzipSync(
            await readFile(join(root, "internal/judges", basename(judge))),
          ).toString("utf8"),
        );
        const csv = await readFile(
          join(root, `internal/qa/submission-task${task.id}-${split}.csv`),
          "utf8",
        );
        assert.ok(Buffer.byteLength(csv) <= 3_000_000);
        const result =
          arena === 2
            ? judgeArena02(csv, truth, pkg.judgeSpecs![task.id]!)
            : task.id === "1"
              ? judgeCV(csv, truth)
              : judgeQA(csv, truth);
        assert.ok(Number.isFinite(result.score));
        console.log(
          JSON.stringify({
            arena,
            task: task.id,
            split,
            accepted: true,
            count: result.count,
          }),
        );
      }
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
