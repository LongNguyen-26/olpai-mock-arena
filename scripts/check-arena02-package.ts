/** Local-only schema/metric parity checks; no Redis/Blob access and no training. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { packageSchema } from "../src/lib/package-schema";
import { judgeArena02 } from "../src/lib/judge-arena02";

async function main() {
  const root = resolve(process.argv[2] ?? "../statements/Arena_02/web_ready");
  const pkg = packageSchema.parse(
    JSON.parse(
      await readFile(join(root, "handoff/package-config.json"), "utf8"),
    ),
  );
  const fixtures = JSON.parse(
    await readFile(join(root, "qa/judge_fixtures.json"), "utf8"),
  );
  for (const f of fixtures) {
    const truth = JSON.parse(
      gunzipSync(
        await readFile(
          join(root, `handoff/judges/task${f.task}-${f.split}.json.gz`),
        ),
      ).toString("utf8"),
    );
    const result = judgeArena02(
      await readFile(join(root, f.csv), "utf8"),
      truth,
      pkg.judgeSpecs![f.task as "1" | "2" | "3"]!,
    );
    assert.ok(
      Math.abs(result.metric! - f.metric) < 1e-12,
      `Metric parity ${f.task}/${f.split}`,
    );
    assert.equal(result.score, f.score);
    console.log(
      `PASS task ${f.task}/${f.split}: ${result.count} rows, metric and score match Python.`,
    );
  }
  console.log(
    `PASS ${pkg.version}: three tasks, nine contestant assets, six private judges.`,
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
