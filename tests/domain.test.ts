import { test } from "node:test";
import assert from "node:assert/strict";
import {
  phaseOf,
  canRead,
  rankTeams,
  visibleSubmission,
} from "../src/lib/domain";
import type { Contest, Submission } from "../src/lib/types";
const c: Contest = {
  id: "run",
  title: "test",
  startAt: 1000,
  forcedEndAt: null,
  publicSeconds: 18000,
  privateSeconds: 3600,
  publicLimit: 20,
  privateLimit: 5,
  createdAt: 0,
};
test("exact phase boundaries and admin access", () => {
  assert.equal(phaseOf({ ...c, startAt: null }, 0), "waiting");
  assert.equal(phaseOf(c, 999), "scheduled");
  assert.equal(phaseOf(c, 1000), "public");
  assert.equal(phaseOf(c, 18000999), "public");
  assert.equal(phaseOf(c, 18001000), "private");
  assert.equal(phaseOf(c, 21601000), "ended");
  assert.equal(canRead(c, 999, "statement"), false);
  assert.equal(canRead(c, 1000, "private"), false);
  assert.equal(canRead(c, 18001000, "private"), true);
  assert.equal(canRead(c, 0, "private", true), true);
  assert.equal(phaseOf({ ...c, forcedEndAt: 2000 }, 2000), "ended");
});
const sub = (id: string, score: number, task: "1" | "2" = "1"): Submission => ({
  id,
  score,
  secondary: 0,
  task,
  split: "private",
  runId: "run",
  teamId: "t",
  userId: "u",
  filename: "a.csv",
  createdAt: Number(id),
  bytes: 10,
  sha256: "x",
  path: "secret-path",
  note: "",
});
test("private scores and storage paths are never serialized before reveal", () => {
  const hidden = visibleSubmission(sub("1", 90), false);
  assert.equal(hidden.score, null);
  assert.equal(hidden.secondary, null);
  assert.equal("path" in hidden, false);
  assert.equal(visibleSubmission(sub("1", 90), true).score, 90);
});
test("private uses selected submission or latest, missing task scores zero", () => {
  const submissions = [sub("1", 90), sub("2", 40), sub("3", 60, "2")],
    teams = [{ id: "t", name: "Team" }];
  assert.equal(rankTeams(teams, submissions, {}, "private")[0].total, 50);
  assert.equal(
    rankTeams(teams, submissions, { "t:1": "1" }, "private")[0].total,
    75,
  );
  assert.equal(rankTeams(teams, [sub("1", 90)], {}, "private")[0].total, 45);
});
test("public uses highest valid score", () => {
  const rows = [sub("1", 90), sub("2", 40)].map((s) => ({
    ...s,
    split: "public" as const,
  }));
  assert.equal(
    rankTeams([{ id: "t", name: "Team" }], rows, {}, "public")[0].task1,
    90,
  );
});
