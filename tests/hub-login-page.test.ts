import { test } from "node:test";
import assert from "node:assert/strict";
import { hubPendingPage } from "../src/lib/hub-login-page";

test("Hub wait page retries only transient states with a bounded counter", () => {
  const url = new URL("https://arena.example/api/workspace/hub/authorize?id=pod&state=nonce&teamId=team");
  const pending = hubPendingPage(url, "starting");
  assert.match(pending, /http-equiv="refresh"/);
  assert.match(pending, /attempt=1/);
  assert.match(pending, /state=nonce/);
  url.searchParams.set("attempt", "60");
  assert.doesNotMatch(hubPendingPage(url, "starting"), /http-equiv="refresh"/);
  for (const state of ["error", "stopped", "ready"] as const)
    assert.doesNotMatch(hubPendingPage(url, state), /http-equiv="refresh"/);
});

test("Hub wait URLs are escaped and malformed counters stop automatic retry", () => {
  const url = new URL('https://arena.example/api/workspace/hub/authorize?state="<script>');
  const page = hubPendingPage(url, "waiting-resource");
  assert.match(page, /đang chờ RAM/);
  assert.doesNotMatch(page, /<script>/);
  assert.match(page, /&amp;attempt=1/);
  for (const attempt of ["-1", "NaN", "6000"]) {
    url.searchParams.set("attempt", attempt);
    assert.doesNotMatch(hubPendingPage(url, "starting"), /http-equiv="refresh"/);
  }
});
