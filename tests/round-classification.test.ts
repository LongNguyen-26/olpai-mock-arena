import test from "node:test";
import assert from "node:assert/strict";
import { roundClassification, roundActivityAt, recentRounds } from "../src/lib/round-classification";
import { roundClassificationSchema } from "../src/lib/round-classification-schema";
import { roundManagementSchema, updateRound } from "../src/lib/round-management";
import { resetRound, reduceRoundControl } from "../src/lib/round-control";
import type { Contest } from "../src/lib/types";
const c:Contest={id:"11111111-1111-4111-8111-111111111111",roundId:"22222222-2222-4222-8222-222222222222",title:"Thi thử",category:"mock",subcategory:"regional",createdAt:100,publishedAt:100,startAt:200,forcedEndAt:null,publicSeconds:100,privateSeconds:50,publicLimit:20,privateLimit:5,revision:2};
test("legacy rounds default to mock, with the explicitly requested Regional placement; explicit labels win over title",()=>{
  assert.deepEqual(roundClassification({title:"Arena 01"}),{category:"mock",subcategory:"general"});
  assert.deepEqual(roundClassification({title:"OlpAI'26 Regional Simulator 01"}),{category:"topic",subcategory:"general"});
  assert.deepEqual(roundClassification({title:"Regional",category:"selection",subcategory:"team"}),{category:"selection",subcategory:"team"});
  assert.equal(roundClassificationSchema.safeParse({category:"topic",subcategory:"national"}).success,false);
  assert.equal(roundClassificationSchema.safeParse({category:"topic",subcategory:"nlp"}).success,true);
});
test("live classification edits require the captured revision and retain the run, policy and activity time",()=>{
  const payload={action:"classify" as const,runId:c.id,revision:2,category:"topic" as const,subcategory:"vision" as const};
  const next=updateRound(c,payload,500);
  assert.equal(next.category,"topic");assert.equal(next.id,c.id);assert.equal(next.startAt,c.startAt);assert.equal(next.revision,3);
  assert.equal(roundActivityAt(next,500),roundActivityAt(c,500));
  assert.throws(()=>updateRound(next,payload,500),/vừa thay đổi/);
  assert.equal(roundManagementSchema.safeParse({...payload,subcategory:"school"}).success,false);
});
test("latest uses actual starts, publications and practice openings, never future starts or arbitrary edits",()=>{
  const rows=[{id:"scheduled",publishedAt:50,startAt:9000},{id:"new",publishedAt:500},{id:"started",publishedAt:100,startAt:700},{id:"practice",publishedAt:90,practice:{startAt:800}}];
  assert.deepEqual(recentRounds(rows,1000).map(r=>r.id),["practice","started","new","scheduled"]);
  assert.deepEqual(recentRounds(rows,10000).map(r=>r.id),["scheduled","practice","started","new"]);
  assert.deepEqual(rows.map(r=>r.id),["scheduled","new","started","practice"]);
  assert.equal(roundActivityAt({publishedAt:100,catalogActivityAt:NaN,startAt:Infinity},1000),100);
});
test("resetting a run preserves classification and latest rank; opening practice becomes a new activity",()=>{
  const reset=resetRound(c,1000,false);
  assert.equal(reset.category,c.category);assert.equal(reset.subcategory,c.subcategory);
  assert.equal(roundActivityAt(reset,1000),roundActivityAt(c,1000));
  const practice=reduceRoundControl(reset,{action:"practice-open",runId:reset.id,revision:2,requestId:"33333333-3333-4333-8333-333333333333",endAt:null,publicVisible:true,privateVisible:true,chatbotEnabled:false,chatbotUntil:null,notebookEnabled:false},1500);
  assert.equal(roundActivityAt(practice,1600),1500);
  assert.deepEqual(recentRounds([{id:"a",publishedAt:100},{id:"b",publishedAt:100}],1000).map(r=>r.id),["a","b"]);
});
