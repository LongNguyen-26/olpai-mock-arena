import { test } from "node:test";
import assert from "node:assert/strict";
import {
  judgeQA,
  judgeCV,
  parseRuns,
  imageAP,
  answerScores,
  normalize,
} from "../src/lib/judge";
const qa = [
  {
    id: "a",
    context: "The lab opened in 2012.",
    answers: [{ text: "2012" }],
    is_impossible: false,
  },
  { id: "b", context: "A lab.", answers: [], is_impossible: true },
];
test("QA matches SQuAD normalization, duplicate token counts, multi-gold and empty answer", () => {
  assert.equal(normalize("The, A! Cat?"), "cat");
  assert.deepEqual(answerScores("cat cat", [{ text: "cat" }]), {
    em: 0,
    f1: 2 / 3,
  });
  assert.deepEqual(answerScores("2012", [{ text: "2011" }, { text: "2012" }]), {
    em: 1,
    f1: 1,
  });
  assert.equal(judgeQA("id,prediction\na,2012\nb,\n", qa).score, 100);
  assert.equal(judgeQA("id,prediction\na,\nb,\n", qa).score, 50);
});
test("strict QA CSV handles BOM and quoted multiline; refuses missing, extra, duplicate, non-span", () => {
  assert.equal(
    judgeQA("\ufeffid,prediction\r\na,2012\r\nb,\r\n", qa).score,
    100,
  );
  for (const csv of [
    "id,prediction\na,2012\n",
    "id,prediction\na,2012\na,2012\nb,\n",
    "id,prediction\na,2013\nb,\n",
    "id,prediction,extra\na,2012,x\nb,,x\n",
    'id,prediction\na,"2012\nb,\n',
  ])
    assert.throws(() => judgeQA(csv, qa));
  const multiline = [
    {
      ...qa[0],
      context: "hello,\nworld",
      answers: [{ text: "hello,\nworld" }],
    },
  ];
  assert.equal(
    judgeQA('id,prediction\na,"hello,\nworld"', multiline).score,
    100,
  );
});
test("RLE uses one-based column-major starts with strict bounds", () => {
  assert.deepEqual(parseRuns("1 1 4 3", 6), [0, 1, 3, 6]);
  for (const text of ["0 1", "1 0", "1 7", "1 2 2 1", "1 x", "1", "2.0 1"])
    assert.throws(() => parseRuns(text, 6));
});
test("instance AP: strict IoU threshold, merge/split and empty images", () => {
  assert.equal(imageAP([[0, 2]], [[0, 2]]), 1);
  assert.equal(imageAP([[0, 2]], [[0, 4]]), 0);
  assert.equal(imageAP([], []), 1);
  assert.equal(imageAP([[0, 2]], []), 0);
  assert.equal(
    imageAP(
      [
        [0, 2],
        [2, 4],
      ],
      [[0, 4]],
    ),
    0,
  );
  assert.equal(
    imageAP(
      [[0, 4]],
      [
        [0, 2],
        [2, 4],
      ],
    ),
    0,
  );
});
test("CV validator rejects overlap, missing ID, empty+nonempty rows", () => {
  const truth = [{ id: "a", width: 2, height: 3, masks: [[0, 1, 3, 6]] }];
  assert.equal(judgeCV("ImageId,EncodedPixels\na,1 1 4 3", truth).score, 100);
  assert.equal(judgeCV("ImageId,EncodedPixels\na,", truth).score, 0);
  for (const csv of [
    "ImageId,EncodedPixels\na,1 2\na,2 2",
    "ImageId,EncodedPixels\na,\na,1 1",
    "ImageId,EncodedPixels\nb,",
    "ImageId,EncodedPixels\n",
  ])
    assert.throws(() => judgeCV(csv, truth));
});
