import test from "node:test";
import assert from "node:assert/strict";
import { rankTeams } from "../src/lib/domain";
import { packageBaselines } from "../src/lib/score-baselines";
import { convertScore, scoreBoard, titlesVisible, alreadyOpened } from "../src/lib/score-display";
import { resetRound,reduceRoundControl } from "../src/lib/round-control";
import type { Contest, ContestPackage, Submission } from "../src/lib/types";
const c={id:"r",startAt:null,publicSeconds:100,privateSeconds:50} as Contest;
const control={action:"score-display",primary:"baseline",extra:"raw",confirmed:false,runId:"r",requestId:"x",revision:0} as const;

test("round title override applies before and after start",()=>{
 assert.equal(titlesVisible(c,10),false);assert.equal(titlesVisible({...c,showTaskTitles:true},10),true);
 assert.equal(titlesVisible({...c,showTaskTitles:false,startAt:2},10),false);
});
test("score settings require complete baselines and confirmation even after a reset",()=>{
 assert.throws(()=>reduceRoundControl(c,control,100,false),/baseline/);
 const reset=resetRound({...c,practice:{startAt:1,endAt:10}},100,true);
 assert.ok(alreadyOpened(reset,100));
 assert.throws(()=>reduceRoundControl(reset,control,100,true),/xác nhận/);
 assert.equal(reduceRoundControl(reset,{...control,confirmed:true},100,true).scoreDisplay?.extra,"raw");
 const pkg={version:"future",tasks:[{id:"1"},{id:"2"}],baselineScores:{public:{"1":1,"2":0},private:{"1":1}}} as ContestPackage;
 assert.equal(packageBaselines(pkg),null);
});
test("normalization uses split leaders, valid team submissions and raw judge scores",()=>{
 const teams=[{id:"A",name:"A"},{id:"B",name:"B"}];
 const row=(teamId:string,task:string,score:number,other={})=>({teamId,task,split:"public",score,metric:0.001,secondary:0,createdAt:1,...other}) as Submission;
 const rows=[row("A","1",90),row("A","2",1),row("B","1",70),row("B","2",10),row("A","2",999,{adminTest:true}),row("A","2",400,{status:"invalid"}),row("A","2",500,{split:"private"})];
 const original=rankTeams(teams,rows,{},"public");
 assert.equal(original[0].teamId,"A");
 const view=scoreBoard(original,["1","2"],{primary:"board",extra:"raw"});
 assert.equal(view.board[0].teamId,"B");assert.equal(view.board[0].extraTotal,80);assert.deepEqual(view.tops,{"1":90,"2":10});
 assert.equal(convertScore(8,"baseline",10,8),0);
 assert.equal(convertScore(9,"baseline",10,8),50);
 assert.equal(convertScore(3,"baseline",3,8),0);
 assert.equal(convertScore(null,"board",10,0),null);
});
