import test from "node:test";
import assert from "node:assert/strict";
import { assistantText } from "../src/lib/chat-presentation";
import { roundTiming } from "../src/lib/round-presentation";

test("assistant display removes thought blocks and model control tokens", () => {
  assert.equal(
    assistantText("<think>private reasoning</think>\nHello! 😊"),
    "Hello! 😊",
  );
  assert.equal(
    assistantText("<think> </think>\nHello! How can I assist you today? 😊"),
    "Hello! How can I assist you today? 😊",
  );
  assert.equal(
    assistantText(
      "&lt;think&gt;hidden&lt;/think&gt;Answer<｜end▁of▁sentence｜>",
    ),
    "Answer",
  );
  assert.equal(assistantText("<|begin_of_text|>Answer<|eot_id|>"), "Answer");
});

test("unfinished thoughts are hidden; ordinary Markdown and code stay intact", () => {
  assert.equal(assistantText("<think>unfinished reasoning"), "");
  assert.equal(assistantText("</think>Answer"), "Answer");
  const code =
    "Example: `<think>`\n\n```xml\n<think>example</think>\n```\n\n**Answer**";
  assert.equal(assistantText(code), code);
  assert.equal(
    assistantText("<think>reason\n```python\nhidden()\n```\n</think>Final"),
    "Final",
  );
});

const round = {
  startAt: 1000,
  privateAt: null,
  forcedEndAt: null,
  publicSeconds: 5,
  privateSeconds: 1,
  unlimited: false,
};

test("round card follows live phase boundaries and counts down the whole round", () => {
  assert.deepEqual(roundTiming(round, 999), {
    phase: "scheduled",
    seconds: 1,
    label: "Bắt đầu sau",
    privateAt: 6000,
  });
  assert.equal(roundTiming(round, 1000).seconds, 6);
  assert.equal(roundTiming(round, 6000).phase, "private");
  assert.equal(roundTiming(round, 6000).seconds, 1);
  assert.equal(roundTiming(round, 7000).phase, "ended");
  assert.equal(roundTiming(round, 9000).seconds, 0);
});

test("round timing handles early private, forced end, waiting and unlimited rounds", () => {
  assert.equal(roundTiming({ ...round, privateAt: 2000 }, 2000).seconds, 1);
  assert.equal(
    roundTiming({ ...round, forcedEndAt: 3000 }, 3000).phase,
    "ended",
  );
  assert.equal(roundTiming({ ...round, startAt: null }, 0).phase, "waiting");
  assert.equal(roundTiming({ ...round, unlimited: true }, 1000).seconds, null);
  assert.equal(
    roundTiming({ ...round, unlimited: true, forcedEndAt: 4000 }, 1000).seconds,
    3,
  );
});
