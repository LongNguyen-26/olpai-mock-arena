import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_CHANGE_INTERVAL,
  accountChangeAllowed,
  nextAccountChange,
} from "../src/lib/account-policy";
test("account changes allow the first edit and open exactly 30 days after the previous successful edit", () => {
  const last = Date.UTC(2026, 10, 7, 0, 30);
  assert.equal(accountChangeAllowed(null, last), true);
  assert.equal(nextAccountChange(undefined), null);
  assert.equal(
    accountChangeAllowed(last, last + ACCOUNT_CHANGE_INTERVAL - 1),
    false,
  );
  assert.equal(
    accountChangeAllowed(last, last + ACCOUNT_CHANGE_INTERVAL),
    true,
  );
  assert.equal(nextAccountChange(last), last + 30 * 24 * 60 * 60 * 1000);
});
