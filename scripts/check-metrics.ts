import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { judgeCV, judgeQA } from "../src/lib/judge";
async function main() {
  for (const task of ["1", "2"]) {
    const truth = JSON.parse(
      gunzipSync(
        await readFile(
          `.local/judges/${task === "1" ? "cv" : "qa"}-public.json.gz`,
        ),
      ).toString("utf8"),
    );
    const csv = await readFile(
      `../statements/contestant/Tac_vu_${task}/submission.csv`,
      "utf8",
    );
    const start = performance.now();
    const result = task === "1" ? judgeCV(csv, truth) : judgeQA(csv, truth);
    console.log(
      JSON.stringify({
        task,
        ...result,
        milliseconds: Math.round(performance.now() - start),
      }),
    );
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
