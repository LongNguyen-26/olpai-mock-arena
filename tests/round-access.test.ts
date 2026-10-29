import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  applyPrivateTransition,
  canRead,
  chatbotAllowed,
  chatbotDeadline,
  contestEnd,
  notebookAllowed,
  phaseOf,
  submissionAccess,
} from "../src/lib/domain";
import {
  reduceRoundControl,
  type RoundControl,
} from "../src/lib/round-control";
import type { Contest } from "../src/lib/types";

const c: Contest = {
  id: randomUUID(),
  title: "QA",
  startAt: 1000,
  privateAt: 2000,
  forcedEndAt: null,
  publicSeconds: 1,
  privateSeconds: 1,
  publicLimit: 20,
  privateLimit: 5,
  createdAt: 0,
};
function change(contest: Contest, value: Record<string, unknown>, now: number) {
  return reduceRoundControl(
    contest,
    {
      runId: contest.id,
      revision: contest.revision ?? 0,
      requestId: randomUUID(),
      ...value,
    } as RoundControl,
    now,
  );
}
test("waiting and scheduled rounds can enter practice directly without a competition phase", () => {
  for (const startAt of [null, 8000]) {
    const waiting = {
      ...c,
      startAt,
      privateAt: startAt == null ? null : 10000,
    };
    const practice = change(
      waiting,
      {
        action: "practice-open",
        endAt: null,
        publicVisible: true,
        privateVisible: true,
        chatbotEnabled: true,
        chatbotUntil: null,
        notebookEnabled: true,
      },
      1500,
    );
    assert.equal(practice.id, c.id);
    assert.equal(practice.startAt, null);
    assert.equal(practice.privateAt, null);
    assert.equal(phaseOf(practice, 1500), "practice");
    assert.equal(phaseOf(practice, 10001), "practice");
    assert.equal(canRead(practice, 1500, "private"), true);
    assert.equal(submissionAccess(practice, 1500, "public").accepting, true);
    assert.equal(submissionAccess(practice, 1500, "private").accepting, true);
    assert.equal(chatbotAllowed(practice, 10001), true);
  }
});
test("reset keeping the leaderboard keeps the run and quota ledger while fencing previous chat work", () => {
  const source = { ...c, chatEpoch: 10, publicLimit: 33, privateLimit: 8 };
  const reset = change(
    source,
    { action: "reset-round", keepLeaderboard: true },
    2400,
  );
  assert.equal(reset.id, source.id);
  assert.equal(reset.publicLimit, source.publicLimit);
  assert.equal(reset.privateLimit, source.privateLimit);
  assert.equal(phaseOf(reset, 2400), "waiting");
  assert.equal(reset.privateStartedAt, undefined);
  assert.ok(reset.chatEpoch! > source.chatEpoch);
  const practice = change(
    reset,
    {
      action: "practice-open",
      endAt: null,
      publicVisible: true,
      privateVisible: true,
      chatbotEnabled: false,
      chatbotUntil: null,
      notebookEnabled: true,
    },
    2500,
  );
  assert.equal(practice.id, source.id);
  assert.equal(phaseOf(practice, 2500), "practice");
});
test("reset without keeping the leaderboard creates a new run and clears active schedules", () => {
  const reset = change(
    { ...c, practice: { startAt: 4000, endAt: null } },
    { action: "reset-round", keepLeaderboard: false },
    4500,
  );
  assert.notEqual(reset.id, c.id);
  assert.equal(phaseOf(reset, 4500), "waiting");
  assert.equal(reset.practice, undefined);
  assert.equal(reset.startAt, null);
  assert.equal(reset.privateAt, null);
});
test("private effects run once for all four policy combinations; visibility never replays them", () => {
  for (const lockPublic of [true, false])
    for (const revokeChatbot of [true, false]) {
      const source = { ...c, privatePolicy: { lockPublic, revokeChatbot } };
      assert.equal(submissionAccess(source, 1999, "public").accepting, true);
      assert.equal(chatbotAllowed(source, 1999), true);
      const entered = applyPrivateTransition(source, 2000);
      assert.equal(entered.privateStartedAt, 2000);
      assert.equal(
        submissionAccess(entered, 2000, "public").accepting,
        !lockPublic,
      );
      assert.equal(chatbotAllowed(entered, 2000), !revokeChatbot);
      let reopened = change(
        entered,
        {
          action: "submission-access",
          split: "public",
          visible: true,
          enabled: true,
        },
        2100,
      );
      reopened = change(
        reopened,
        { action: "chatbot-access", enabled: true, until: null },
        2100,
      );
      for (const visible of [false, true, false, true])
        reopened = change(
          reopened,
          {
            action: "submission-access",
            split: "private",
            visible,
            enabled: true,
          },
          2200,
        );
      assert.equal(applyPrivateTransition(reopened, 2300), reopened);
      assert.equal(submissionAccess(reopened, 2300, "public").accepting, true);
      assert.equal(chatbotAllowed(reopened, 2300), true);
    }
});
test("live timing is independent from duration presets and cannot roll back private", () => {
  const edited = change(
    c,
    { action: "timing", privateAt: 2500, endAt: 6000 },
    1500,
  );
  assert.equal(edited.id, c.id);
  assert.equal(edited.startAt, c.startAt);
  assert.equal(phaseOf(edited, 2499), "public");
  assert.equal(phaseOf(edited, 2500), "private");
  assert.equal(phaseOf(edited, 5999), "private");
  assert.equal(phaseOf(edited, 6000), "ended");
  assert.throws(
    () =>
      change(edited, { action: "timing", privateAt: 5500, endAt: 7000 }, 3000),
    /không thể đổi ngược/,
  );
  const extended = change(
    edited,
    { action: "timing", privateAt: 2500, endAt: null },
    3000,
  );
  assert.equal(contestEnd(extended), null);
  assert.equal(phaseOf(extended, 999999), "private");
  assert.throws(
    () => change(c, { action: "timing", privateAt: 1400, endAt: 7000 }, 1500),
    /Chuyển sang private ngay/,
  );
  assert.throws(
    () => change(c, { action: "timing", privateAt: 7000, endAt: 6000 }, 1500),
    /sau mốc private/,
  );
});
test("early private preserves the chosen end including an unlimited end", () => {
  const early = change(
    c,
    {
      action: "open-private",
      lockPublic: true,
      revokeChatbot: false,
      endAt: contestEnd(c),
    },
    1500,
  );
  assert.equal(early.privateStartedAt, 1500);
  assert.equal(contestEnd(early), 3000);
  assert.equal(chatbotAllowed(early, 1600), true);
  assert.equal(chatbotDeadline(early, 1600), 3000);
  assert.equal(
    contestEnd(
      change(
        c,
        {
          action: "open-private",
          lockPublic: false,
          revokeChatbot: false,
          endAt: null,
        },
        1500,
      ),
    ),
    null,
  );
});
test("hiding a split blocks submissions but preserves reading and its configured enabled state", () => {
  const hidden = change(
    c,
    {
      action: "submission-access",
      split: "public",
      visible: false,
      enabled: true,
    },
    1500,
  );
  assert.equal(submissionAccess(hidden, 1500, "public").accepting, false);
  assert.equal(submissionAccess(hidden, 1500, "public").enabled, true);
  assert.equal(canRead(hidden, 1500, "public"), true);
  const shown = change(
    hidden,
    {
      action: "submission-access",
      split: "public",
      visible: true,
      enabled: true,
    },
    1600,
  );
  assert.equal(submissionAccess(shown, 1600, "public").accepting, true);
  assert.equal(submissionAccess(shown, 1600, "private").accepting, false);
});
test("post-contest practice uses one deadline and retains run, quotas and competition dates", () => {
  const practice = change(
    c,
    {
      action: "practice-open",
      endAt: 6000,
      publicVisible: true,
      privateVisible: true,
      chatbotEnabled: true,
      chatbotUntil: 5500,
      notebookEnabled: true,
    },
    4000,
  );
  assert.equal(practice.id, c.id);
  assert.equal(practice.publicLimit, 20);
  assert.equal(practice.privateLimit, 5);
  assert.equal(practice.startAt, c.startAt);
  assert.equal(practice.privateAt, c.privateAt);
  assert.equal(phaseOf(practice, 4000), "practice");
  assert.equal(contestEnd(practice), 6000);
  for (const split of ["public", "private"] as const)
    assert.equal(submissionAccess(practice, 4500, split).accepting, true);
  assert.equal(chatbotAllowed(practice, 5499), true);
  assert.equal(chatbotAllowed(practice, 5500), false);
  assert.equal(notebookAllowed(practice, 5999), true);
  assert.equal(notebookAllowed(practice, 6000), false);
  assert.equal(phaseOf(practice, 6000), "ended");
  assert.equal(chatbotDeadline(practice, 4500), 5500);
  const closed = change(practice, { action: "practice-close" }, 5000);
  assert.equal(phaseOf(closed, 5000), "ended");
  assert.equal(chatbotAllowed(closed, 5000), false);
  const again = change(
    closed,
    {
      action: "practice-open",
      endAt: null,
      publicVisible: false,
      privateVisible: true,
      chatbotEnabled: true,
      chatbotUntil: null,
      notebookEnabled: false,
    },
    5100,
  );
  assert.equal(phaseOf(again, 999999999), "practice");
  assert.equal(chatbotAllowed(again, 999999999), true);
  assert.equal(notebookAllowed(again, 5200), false);
  assert.equal(again.id, c.id);
});
test("chatbot grant expiration and private cutoff remain independent", () => {
  assert.equal(chatbotDeadline(c, 1500), 2000);
  const entered = applyPrivateTransition(c, 2000);
  const reopened = change(
    entered,
    { action: "chatbot-access", enabled: true, until: 2700 },
    2200,
  );
  assert.equal(chatbotAllowed(reopened, 2699), true);
  assert.equal(chatbotAllowed(reopened, 2700), false);
  assert.equal(chatbotDeadline(reopened, 2200), 2700);
  const blocked = change(
    reopened,
    { action: "chatbot-access", enabled: false, until: null },
    2300,
  );
  assert.ok(blocked.chatEpoch! > reopened.chatEpoch!);
  assert.equal(chatbotAllowed({ ...reopened, hidden: true }, 2400), false);
});
