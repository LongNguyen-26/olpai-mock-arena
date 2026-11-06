import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve,join } from "node:path";
import { gunzipSync } from "node:zlib";
import { judgeZip } from "../src/lib/judge-zip";
import { packageSchema } from "../src/lib/package-schema";

async function main() {
  const root = resolve(process.argv[2] ?? "../statements/Regional_01/web_ready/release_20261106");
  const pkg = packageSchema.parse(JSON.parse(await readFile(join(root,"handoff/package-config.json"),"utf8")));
  const qa = join(root,"internal/qa");
  const reference = JSON.parse(await readFile(join(qa,"baselines.json"),"utf8"));
  for (const task of pkg.tasks) {
    const kind = task.zipJudge!;
    const name = kind==="dim-absa" ? "nlp" : "cv";
    for (const split of ["public","private"] as const) {
      const submission = await readFile(join(qa,"web-submissions",name+"-"+split+".zip"));
      const truth = JSON.parse(gunzipSync(await readFile(join(root,"internal/judges",`task${task.id}-${split}.json.gz`))).toString());
      const result = await judgeZip(submission,truth,kind);
      assert.ok(Math.abs(reference[name+"_"+split].score-result.score)<1e-9);
      await assert.rejects(judgeZip(submission.subarray(0,40),truth,kind),/ZIP/);
      await assert.rejects(judgeZip(submission,truth,kind==="dim-absa"?"canal-recall":"dim-absa"),/ZIP/);
      console.log(name,split,result.score,result.count);
    }
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
