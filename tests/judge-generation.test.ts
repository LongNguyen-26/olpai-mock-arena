import test from "node:test";
import assert from "node:assert/strict";
import { judgeTrimap, judgeGeneration, sentenceChrf2 } from "../src/lib/judge-generation";
import { SubmissionError } from "../src/lib/judge";

test("trimap pools pixel intersections across images and weighs all three classes equally", () => {
  const truth = { width: 4, height: 1, items: [{ id: "a", pet: "1 2", border: "3 1" }, { id: "b", pet: "1 1", border: "2 1" }] };
  assert.equal(judgeTrimap("id,pet_rle,border_rle\na,1 2,3 1\nb,1 1,2 1", truth).score, 100);
  const r = judgeTrimap("id,pet_rle,border_rle\na,1 3,\nb,1 1,2 1", truth);
  assert.equal(r.score, 75); // background=1, pet=3/4, border=1/2
  assert.equal(r.secondary, 50);
});
test("trimap rejects overlap, overflow, duplicates and missing IDs; empty masks valid", () => {
  const truth = { width: 3, height: 1, items: [{ id: "a", pet: "1 1", border: "2 1" }] };
  for (const rows of ["a,1 2,2 1", "a,4 1,", "a,1 1,\na,1 1,", "", "other,,", "a,1 1 1 1,"])
    assert.throws(() => judgeTrimap("id,pet_rle,border_rle\n" + rows, truth), SubmissionError);
  assert.ok(Number.isFinite(judgeTrimap("id,pet_rle,border_rle\na,,", truth).score));
});
test("chrF2 short strings, Unicode normalization, punctuation and recall weighting", () => {
  assert.equal(sentenceChrf2("", "abc"), 0);
  assert.equal(sentenceChrf2("Ａ b", "ab"), 1);
  assert.equal(sentenceChrf2("a\u0085b", "ab"), 1);
  assert.equal(sentenceChrf2("😀", "😀"), 1);
  assert.equal(sentenceChrf2("abc", "abc"), 1);
  assert.equal(sentenceChrf2("ab", "ac"), 0.25); // mean unigram .5 and bigram 0
  assert.ok(sentenceChrf2("abc", "abcdef") < sentenceChrf2("abcdef", "abc"));
  assert.ok(sentenceChrf2("hello!", "hello") < 1);
});
test("generation uses best reference per ID, supports quoted CSV and enforces complete bounded input", () => {
  const truth = { items: [{ id: "a", references: ["no", "Yes, please."] }, { id: "b", references: ["abc"] }] };
  assert.equal(judgeGeneration('id,prediction\na,"Yes, please."\nb,abc', truth).score, 100);
  for (const rows of ["a,no", "a,no\na,no", "a,no\nx,abc", "a," + "z".repeat(1001) + "\nb,abc"])
    assert.throws(() => judgeGeneration("id,prediction\n" + rows, truth), SubmissionError);
  assert.equal(judgeGeneration("id,prediction\na,\nb,", truth).score, 0);
});
