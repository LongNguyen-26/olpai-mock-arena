import test from "node:test";
import assert from "node:assert/strict";
import { moveRoundOrder, updateRound, roundManagementSchema } from "../src/lib/round-management";
import type { Contest } from "../src/lib/types";
const c:Contest={id:"11111111-1111-4111-8111-111111111111",roundId:"22222222-2222-4222-8222-222222222222",title:"Vòng đang mở",revision:4,startAt:1000,forcedEndAt:null,publicSeconds:100,privateSeconds:100,publicLimit:20,privateLimit:5,createdAt:0};
test("moving respects boundaries and does not mutate the caller's order",()=>{
  const ids=["a","b","c"];
  assert.deepEqual(moveRoundOrder(ids,"b","up"),["b","a","c"]);
  assert.deepEqual(moveRoundOrder(ids,"b","down"),["a","c","b"]);
  assert.deepEqual(moveRoundOrder(ids,"a","up"),ids);
  assert.deepEqual(ids,["a","b","c"]);
});
test("live rounds can be renamed without resetting run, schedule, quota or policies",()=>{
  const next=updateRound(c,{action:"rename",runId:c.id,revision:4,title:"Tên mới"},2000);
  assert.deepEqual(next,{...c,title:"Tên mới",revision:5});
  assert.throws(()=>updateRound(c,{action:"rename",runId:c.id,revision:3,title:"Tên lỗi"},2000),/vừa thay đổi/);
  assert.equal(roundManagementSchema.safeParse({action:"rename",runId:c.id,revision:4,title:"   "}).success,false);
});
test("deletion requires current version and confirmed title, preserves binding and fences old chat",()=>{
  const next=updateRound(c,{action:"delete",runId:c.id,revision:4,confirmTitle:c.title},2000);
  assert.equal(next.deletedAt,2000);assert.equal(next.hidden,true);assert.equal(next.chatEpoch,1);
  assert.equal(next.id,c.id);assert.equal(next.roundId,c.roundId);
  assert.throws(()=>updateRound(c,{action:"delete",runId:c.id,revision:4,confirmTitle:"Vòng khác"},2000),/vừa thay đổi/);
  assert.throws(()=>updateRound(next,{action:"delete",runId:c.id,revision:5,confirmTitle:c.title},2000),/Không tìm thấy/);
});
