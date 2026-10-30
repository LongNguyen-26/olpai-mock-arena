import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { packageSchema } from "../src/lib/package-schema";
import { judgeDirect } from "../src/lib/judge-direct";

async function main() {
  const root = resolve(process.argv[2] ?? "../statements/Arena_04");
  const release = join(root, "web_ready/release_20261030");
  const pkg = packageSchema.parse(JSON.parse(await readFile(join(release, "handoff/package-config.json"), "utf8")));
  const plan = JSON.parse(await readFile(join(release, "handoff/upload-plan.json"), "utf8"));
  assert.equal(plan.version, pkg.version);
  assert.equal(plan.objects.length, pkg.assets.length + 4);
  assert.equal(new Set(plan.objects.map((x: { key: string }) => x.key)).size, plan.objects.length);
  for (const entry of plan.objects) {
    assert.ok(entry.key.startsWith(`packages/${pkg.version}/`));
    assert.ok(!/local_co_/i.test(entry.local));
    const bytes = await readFile(join(release, entry.local));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  }
  const reference = JSON.parse(await readFile(join(root, "qa/baseline_results.json"), "utf8"));
  const results = [];
  for (const record of reference) {
    const task = String(record.task) as "1" | "2";
    const truth = JSON.parse(gunzipSync(await readFile(join(release, `internal/judges/task${task}-${record.split}.json.gz`))).toString("utf8"));
    const csv = await readFile(join(root, `qa/notebook_runtime/Tac_vu_${task}/submission_${record.split}.csv`), "utf8");
    const result = judgeDirect(csv, truth, pkg.directJudgeSpecs![task]!);
    assert.ok(Math.abs(result.score - record.score) < 1e-9);
    assert.ok(Math.abs(result.secondary - record.secondary) < 1e-9);
    assert.equal(result.count, record.count);
    results.push({ task, split: record.split, ...result });
    console.log(`PASS task ${task} ${record.split}: score=${result.score.toFixed(8)}, rows=${result.count}`);
  }
  const wrong = structuredClone(pkg);
  wrong.tasks[0].columns = ["id", "labels"];
  assert.equal(packageSchema.safeParse(wrong).success, false);
  const overlap = structuredClone(pkg) as Record<string, unknown>;
  overlap.judgeSpecs = { "1": { kind: "pump-f1", maxScore: 100, baseline: 0, reference: 1 } };
  assert.equal(packageSchema.safeParse(overlap).success, false);
  await writeFile(join(release, "internal/qa/web-judge-contract.json"), JSON.stringify({ version: pkg.version, objectChecksums: plan.objects.length, baselineResults: results, schemaMismatchRejected: true, overlappingSpecsRejected: true }, null, 2));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
