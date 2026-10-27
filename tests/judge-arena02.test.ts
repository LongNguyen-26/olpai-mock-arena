import test from "node:test";
import assert from "node:assert/strict";
import {
  judgeArena02,
  roundScore,
  ASPECTS,
  PUMP_LABELS,
} from "../src/lib/judge-arena02";
import { SubmissionError } from "../src/lib/judge";
import { rankTeams } from "../src/lib/domain";
import { packageSchema } from "../src/lib/package-schema";
import type { JudgeSpec, Submission } from "../src/lib/types";

const pinball: JudgeSpec = {
  kind: "pinball",
  maxScore: 30,
  baseline: 3.79,
  reference: 2.6,
};
const aspects: JudgeSpec = {
  kind: "aspect-f1",
  maxScore: 35,
  baseline: 0.817,
  reference: 0.9,
};
const pump: JudgeSpec = {
  kind: "pump-f1",
  maxScore: 35,
  baseline: 0.273,
  reference: 0.93,
};
test("score rounding preserves Python binary64/ties-to-even behavior", () => {
  for (const [value, expected] of [
    [2.675, 2.67],
    [1.665, 1.67],
    [0.125, 0.12],
    [0.375, 0.38],
    [0, 0],
    [35, 35],
  ])
    assert.equal(roundScore(value), expected);
});
test("pinball uses the organizer formula, aligns IDs and clips score", () => {
  const truth = [
    { id: "a", delivery_minutes: 20 },
    { id: "b", delivery_minutes: 30 },
  ];
  const r = judgeArena02("id,p50,p90\nb,20,25\na,10,15", truth, pinball);
  assert.equal(r.metric, 4.75);
  assert.equal(r.score, 0);
  assert.equal(
    judgeArena02("id,p50,p90\na,20,20\nb,30,30", truth, pinball).score,
    30,
  );
  assert.equal(
    judgeArena02("\ufeffid,p50,p90\na,2e1,20\nb,30,30\n", truth, pinball).score,
    30,
  );
});
test("aspect F1 averages five fixed three-class scores, including missing classes", () => {
  const truth: ({ id: string } & Record<string, string | number>)[] = [
    -1, 0, 1,
  ].map((v, i) => ({
    id: String(i),
    ...Object.fromEntries(ASPECTS.map((a) => [a, v])),
  }));
  const header = "id," + ASPECTS.join(",");
  const perfect =
    header +
    "\n" +
    truth.map((r, i) => [i, ...ASPECTS.map((a) => r[a])].join(",")).join("\n");
  assert.equal(judgeArena02(perfect, truth, aspects).metric, 1);
  assert.equal(judgeArena02(perfect, truth, aspects).score, 35);
  const one = [{ id: "x", ...Object.fromEntries(ASPECTS.map((a) => [a, 0])) }];
  assert.equal(
    judgeArena02(header + "\nx,0,0,0,0,0", one, aspects).metric,
    1 / 3,
  );
});
test("pump F1 matches sklearn's observed label union", () => {
  const truth = PUMP_LABELS.map((label, i) => ({ id: String(i), label }));
  const perfect =
    "id,label\n" + truth.map((r) => `${r.id},${r.label}`).join("\n");
  assert.equal(judgeArena02(perfect, truth, pump).metric, 1);
  assert.equal(judgeArena02(perfect, truth, pump).score, 35);
  assert.equal(
    judgeArena02(
      "id,label\na,binh_thuong",
      [{ id: "a", label: "binh_thuong" }],
      pump,
    ).metric,
    1,
  );
  const r = judgeArena02(
    "id,label\na,binh_thuong\nb,binh_thuong",
    [
      { id: "a", label: "binh_thuong" },
      { id: "b", label: "mat_can_bang" },
    ],
    pump,
  );
  assert.equal(r.metric, 1 / 3);
});
test("rejects malformed, missing, duplicate, foreign, empty, non-finite and invalid class values", () => {
  const truth = [
    { id: "a", delivery_minutes: 20 },
    { id: "b", delivery_minutes: 30 },
  ];
  for (const csv of [
    "id,p50,p90\na,20,30",
    "id,p50,p90\na,20,30\na,20,30",
    "id,p50,p90\na,20,30\nx,20,30",
    "id,p50,p90\na,,30\nb,20,30",
    "id,p50,p90\na,NaN,30\nb,20,30",
    "id,p50,p90\na,Infinity,30\nb,20,30",
    "id,p50,p90\na,1e309,30\nb,20,30",
    "id,p90,p50\na,20,30\nb,20,30",
    "id,p50,p90\na,20,30,40\nb,20,30",
  ])
    assert.throws(() => judgeArena02(csv, truth, pinball), SubmissionError);
  assert.throws(
    () =>
      judgeArena02(
        "id,label\na,wrong",
        [{ id: "a", label: "binh_thuong" }],
        pump,
      ),
    SubmissionError,
  );
  assert.throws(
    () =>
      judgeArena02(
        "id," + ASPECTS.join(",") + "\na,0,0,2,0,0",
        [{ id: "a" }],
        aspects,
      ),
    SubmissionError,
  );
});
test("ranking sums three per-task bests; old two-task rounds remain unchanged", () => {
  const submissions = [30, 35, 35].map((score, i) => ({
    id: String(i),
    teamId: "t",
    task: String(i + 1),
    split: "public",
    createdAt: i,
    score,
    secondary: 0,
  })) as Submission[];
  const board = rankTeams(
    [{ id: "t", name: "Team" }],
    submissions,
    {},
    "public",
    ["1", "2", "3"],
  );
  assert.equal(board[0].total, 100);
  assert.equal(board[0].scores["3"], 35);
  assert.equal(
    rankTeams([{ id: "t", name: "Team" }], submissions, {}, "public")[0].total,
    65,
  );
});
test("package schema requires task/judge/display consistency", () => {
  const pair = {
    public: "packages/fixture/public.gz",
    private: "packages/fixture/private.gz",
  };
  const pkg = {
    version: "fixture",
    title: "Fixture",
    tasks: [
      { id: "1", title: "A", content: "A" },
      { id: "2", title: "B", content: "B" },
    ],
    assets: [],
    judges: { "1": pair, "2": pair },
  };
  assert.equal(packageSchema.safeParse(pkg).success, true);
  assert.equal(
    packageSchema.safeParse({ ...pkg, tasks: [pkg.tasks[0], pkg.tasks[0]] })
      .success,
    false,
  );
  assert.equal(
    packageSchema.safeParse({ ...pkg, judges: { ...pkg.judges, "3": pair } })
      .success,
    false,
  );
  assert.equal(
    packageSchema.safeParse({
      ...pkg,
      tasks: [...pkg.tasks, { id: "3", title: "C", content: "C" }],
      judges: { ...pkg.judges, "3": pair },
    }).success,
    false,
  );
});
