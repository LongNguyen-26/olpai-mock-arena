import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
async function main() {
  if (!process.env.ARENA_NAMESPACE?.startsWith("arena:qa:"))
    throw new Error("QA namespace required");
  const session = JSON.parse(await readFile(".local/qa-session.json", "utf8"));
  const root = "../statements/Arena_01/web_ready";
  const report = JSON.parse(
    await readFile(root + "/qa/web_contract_report.json", "utf8"),
  );
  for (const expected of report.judgeResults) {
    const form = new FormData();
    form.set("task", expected.task);
    form.set("split", expected.phase);
    form.set("nonce", randomUUID());
    form.set(
      "file",
      new File(
        [
          await readFile(
            `${root}/qa/runs/Tac_vu_${expected.task}/${expected.phase}_submission.csv`,
          ),
        ],
        "baseline.csv",
      ),
    );
    const res = await fetch(
      `http://localhost:3000/api/submit?round=${session.first}`,
      {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: session.adminCookie,
        },
        body: form,
      },
    );
    const value = await res.json();
    assert.equal(res.status, 200, JSON.stringify(value));
    assert.ok(Math.abs(value.score - expected.score) < 1e-9);
    assert.ok(Math.abs(value.secondary - expected.secondary) < 1e-9);
    assert.equal(value.adminTest, true);
    console.log(
      `PASS standardized task ${expected.task} ${expected.phase}: ${value.score}`,
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
