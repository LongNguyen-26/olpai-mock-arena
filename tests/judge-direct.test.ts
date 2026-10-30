import test from "node:test";
import assert from "node:assert/strict";
import { judgeScaledMAE, judgeMultilabel } from "../src/lib/judge-direct";
import { SubmissionError } from "../src/lib/judge";

const forecast = { horizon: 1, scales: { small: 2, large: 200 }, items: [
  { id: "a", series_id: "small", value: 4 },
  { id: "b", series_id: "large", value: 400 },
] };
test("scaled MAE balances series scales and uses the reciprocal score", () => {
  assert.deepEqual(judgeScaledMAE("id,prediction\na,6\nb,600\n", forecast),
    { score: 50, secondary: 0, metric: 1, count: 2 });
  assert.equal(judgeScaledMAE("\ufeffid,prediction\nb,4e2\na,4.0\n", forecast).score, 100);
  assert.equal(judgeScaledMAE("id,prediction\na,0\nb,0\n", forecast).score, 100 / 3);
  assert.ok(Number.isFinite(judgeScaledMAE("id,prediction\na,1e308\nb,1e308\n", forecast).metric));
});
test("forecast rejects malformed values and incomplete or duplicate IDs", () => {
  for (const value of ["", "NaN", "Infinity", "-1", "1e309", "0x10", " 4", "4 "])
    assert.throws(() => judgeScaledMAE(`id,prediction\na,${value}\nb,400\n`, forecast), SubmissionError);
  for (const text of ["id,prediction\na,4\n", "id,prediction\na,4\na,4\n", "id,prediction\na,4\nx,4\n", "id,prediction,extra\na,4,0\nb,400,0\n"])
    assert.throws(() => judgeScaledMAE(text, forecast), SubmissionError);
});
const emotions = { labelCount: 3, items: [{ id: "a", labels: [0, 1] }, { id: "b", labels: [2] }] };
test("multilabel metric is a label macro average with exact set match", () => {
  const perfect = judgeMultilabel("id,labels\na,0 1\nb,2\n", emotions);
  assert.equal(perfect.score, 100); assert.equal(perfect.secondary, 100);
  const partial = judgeMultilabel("id,labels\na,1\nb,2\n", emotions);
  assert.ok(Math.abs(partial.score - 200 / 3) < 1e-12); assert.equal(partial.secondary, 50);
  const absent = { labelCount: 4, items: emotions.items };
  assert.equal(judgeMultilabel("id,labels\na,0 1\nb,2\n", absent).score, 75);
});
test("multilabel rejects empty sets, invalid labels, duplicates, unsorted labels and ID errors", () => {
  for (const value of ["", "1 0", "1 1", "3", "-1", "0.5", "01", "0  1", "0,1", "0 1 "])
    assert.throws(() => judgeMultilabel(`id,labels\na,"${value}"\nb,2\n`, emotions), SubmissionError);
  for (const text of ["id,labels\na,0\n", "id,labels\na,0\na,2\n", "id,labels\nx,0\nb,2\n"])
    assert.throws(() => judgeMultilabel(text, emotions), SubmissionError);
});
