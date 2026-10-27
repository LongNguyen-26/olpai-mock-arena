import test from "node:test";
import assert from "node:assert/strict";
import { chatSession } from "../src/lib/chat-session";

function tab() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

test("two tabs on the same Pod get distinct IDs; reload and repeated setup keep them", () => {
  const first = tab(),
    second = tab();
  const a = chatSession(first, "pod"),
    b = chatSession(second, "pod");
  assert.notEqual(a, b);
  assert.notEqual(a, "pod");
  assert.equal(chatSession(first, "pod"), a);
  assert.equal(chatSession(second, "pod"), b);
  assert.equal(chatSession(first, "pod"), a);
});

test("new chat rotates only this tab and Pod, and survives reload", () => {
  const first = tab(),
    second = tab();
  const a = chatSession(first, "pod"),
    b = chatSession(second, "pod");
  const other = chatSession(first, "other-pod");
  const next = chatSession(first, "pod", true);
  assert.notEqual(next, a);
  assert.equal(chatSession(first, "pod"), next);
  assert.equal(chatSession(second, "pod"), b);
  assert.equal(chatSession(first, "other-pod"), other);
});

test("legacy Pod ID defaults are replaced but an explicit conversation is preserved", () => {
  const storage = tab();
  storage.setItem("arena-chat:pod", "pod");
  const next = chatSession(storage, "pod");
  assert.notEqual(next, "pod");
  assert.equal(chatSession(storage, "pod"), next);
});
