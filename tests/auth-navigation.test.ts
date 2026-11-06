import test from "node:test";
import assert from "node:assert/strict";
import { authReturnPath, loginHref, publicSections } from "../src/lib/auth-navigation";
test("auth returns to the chosen round and section without accepting external or auth redirects",()=>{
  const next="/?round=123#submit";
  assert.equal(authReturnPath(next),next);
  assert.equal(new URL(loginHref(next),"https://arena.invalid").searchParams.get("next"),next);
  for(const value of ["https://evil.invalid","//evil.invalid","/\\evil.invalid","/login?next=//evil.invalid","/auth/callback","/\nLocation: evil",null,[]]) assert.equal(authReturnPath(value),"/");
  assert.deepEqual([...publicSections],["rounds","overview","statement","leaderboard"]);
});
