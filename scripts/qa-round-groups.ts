/** Loopback PostgreSQL only. Isolated round/user fixtures; no mail or GPU. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile,writeFile } from "node:fs/promises";
import { createSqlUser, saveSqlPackage } from "../src/lib/entity-repository";
import { hashPassword } from "../src/lib/auth";
import { createRound, control, getContest, registerRound } from "../src/lib/rounds";
import { manageRound } from "../src/lib/round-management";
import { importColumns } from "../src/lib/database-snapshot";
import { namespace, query, sqlTransaction, closeSqlPools } from "../src/lib/sql";
import { roundActivityAt } from "../src/lib/round-classification";
import type { ContestPackage } from "../src/lib/types";

async function main() {
  assert.ok(["localhost","127.0.0.1"].includes(new URL(process.env.ARENA_DATABASE_URL!).hostname),"Use disposable local PostgreSQL");
  process.env.ARENA_DATABASE_MODE="postgres";process.env.ARENA_RUNPOD_MODE="disabled";process.env.ARENA_NAMESPACE=`arena:qa:round-groups:${randomUUID()}`;
  const ns=namespace(),base="http://localhost:3133",password="QA-round-groups-password-2026",hash=await hashPassword(password);
  const user=(username:string)=>({id:randomUUID(),username,name:username,password:hash,teamId:null,createdAt:Date.now()});
  const admin=user("qa_groups_admin"),student=user("qa_groups_student"),checks:string[]=[];
  let stop:(()=>void)|undefined;
  const stopper=createServer((req,res)=>{if(req.method==="POST"&&req.url==="/__qa/stop"){res.end("stopping");stop?.();}else{res.writeHead(404);res.end();}});
  const app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--port","3133"],{windowsHide:true,env:{...process.env,ARENA_AUTH_MODE:"legacy",GROQ_RUNNER_ENABLED:"false",RENDER:"false"},stdio:"ignore"});
  const jar=new Map<string,string>();
  async function request(path:string,value?:unknown,cookies=jar) {
    const r=await fetch(base+path,{method:value===undefined?"GET":"POST",redirect:"manual",headers:{Origin:base,"Content-Type":"application/json",Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join("; ")},...(value===undefined?{}:{body:JSON.stringify(value)})});
    for(const raw of r.headers.getSetCookie()){const [pair]=raw.split(";"),i=pair.indexOf("=");if(/max-age=0/i.test(raw))cookies.delete(pair.slice(0,i));else cookies.set(pair.slice(0,i),pair.slice(i+1));}
    return r;
  }
  try {
    await query("insert into arena.state(ns,imported_at) values($1,$2)",[ns,Date.now()]);
    await createSqlUser(admin,"primary");await createSqlUser(student);
    const packageId="qa-round-groups";
    await saveSqlPackage({version:packageId,title:"QA phân nhóm",statement:"",tasks:[{id:"1",title:"Phân loại văn bản",content:"# QA"},{id:"2",title:"Phân loại ảnh",content:"# QA"}],assets:[],judges:{"1":{public:"qa",private:"qa"},"2":{public:"qa",private:"qa"}},importedAt:Date.now()});
    const ids:string[]=[];
    for(let i=1;i<=9;i++)ids.push((await createRound(`Vòng QA ${i.toString().padStart(2,"0")}`,packageId,i<6?{category:"mock",subcategory:"general"}:i<9?{category:"topic",subcategory:"nlp"}:{category:"selection",subcategory:"school"})).id);
    const hidden=await createRound("QA hidden never public",packageId);await control("visibility",{hidden:true},hidden.id);
    await control("start",{},ids[0]);
    const started=await getContest(ids[0]);assert.ok(started.catalogActivityAt!>=started.publishedAt!);
    const oldActivity=roundActivityAt(started,Date.now());
    await control("reset",{keepLeaderboard:true},ids[0]);
    assert.equal(roundActivityAt(await getContest(ids[0]),Date.now()),oldActivity);
    const before=await getContest(ids[0]);
    await control("practice-open",{runId:before.id,revision:before.revision??0,requestId:randomUUID(),endAt:null,publicVisible:true,privateVisible:false,chatbotEnabled:false,chatbotUntil:null,notebookEnabled:false},ids[0]);
    assert.ok((await getContest(ids[0])).catalogActivityAt!>=oldActivity);
    const edit=await getContest(ids[1]);
    const race=await Promise.allSettled(["nlp","vision"].map(subcategory=>manageRound(ids[1],{action:"classify",runId:edit.id,revision:edit.revision??0,category:"topic",subcategory:subcategory as "nlp"|"vision"})));
    assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
    checks.push("publication/start/practice activity, reset rank preservation, concurrent classification version fence");
    for(let i=0;i<60;i++){try{if((await fetch(base+"/api/health")).ok)break;}catch{}await new Promise(r=>setTimeout(r,400));}
    const guest=await (await request("/api/arena")).json();
    assert.equal(guest.rounds.length,9);assert.ok(!JSON.stringify(guest).includes("QA hidden never public"));
    assert.ok(guest.rounds.every((r:{category:string;subcategory:string})=>r.category&&r.subcategory));
    assert.equal((await request("/api/admin/round/manage?round="+ids[0],{action:"classify",runId:before.id,revision:0,category:"mock",subcategory:"general"})).status,401);
    await request("/api/auth/login",{username:student.username,password});
    assert.equal((await request("/api/admin/round/create",{title:"Forbidden",packageId,category:"mock",subcategory:"general"})).status,403);
    assert.equal((await request("/api/admin/round/manage?round="+ids[0],{action:"classify",runId:before.id,revision:0,category:"mock",subcategory:"general"})).status,403);
    await request("/api/auth/logout",{});await request("/api/auth/login",{username:admin.username,password});
    assert.equal((await request("/api/admin/round/create",{title:"Invalid labels",packageId,category:"topic",subcategory:"national"})).status,400);
    const created=await request("/api/admin/round/create",{title:"QA phát hành có nhóm",packageId,category:"selection",subcategory:"team"});assert.equal(created.status,200);
    const createdId=(await created.json()).id,current=await getContest(createdId);
    assert.equal(current.category,"selection");assert.equal(current.subcategory,"team");assert.ok(current.publishedAt);
    assert.equal((await request("/api/admin/round/manage?round="+createdId,{action:"classify",runId:current.id,revision:current.revision??0,category:"topic",subcategory:"ml"})).status,200);
    assert.equal((await getContest(createdId)).category,"topic");
    checks.push("guest visibility and category metadata, guest/student mutation denial, validated publish labels, post-publish classification");
    await request("/api/auth/logout",{});
    if(process.argv.includes("--resources")) {
      const specs=[{dir:"Regional_01/web_ready/release_20261106",title:"QA Regional 01",category:"topic" as const},{dir:"Arena_04/web_ready/release_20261030",title:"QA Mô phỏng thi 03",category:"mock" as const}];
      for(const spec of specs) {
        const pkg=JSON.parse(await readFile(`../statements/${spec.dir}/handoff/package-config.json`,"utf8")) as ContestPackage;
        await saveSqlPackage({...pkg,importedAt:Date.now()});
        const round=(await createRound(spec.title,pkg.version,{category:spec.category,subcategory:"general"})).id;
        const path="/api/statement?round="+round;
        assert.equal((await request(path)).status,403);
        await request("/api/auth/login",{username:admin.username,password});
        const adminStatement=await (await request(path)).json();assert.ok(adminStatement.generalInstructions);assert.ok(adminStatement.tasks.some((t:{content:string})=>t.content.includes("$$")));
        const before=await getContest(round);await control("start",{},round);assert.equal((await getContest(round)).id,before.id);
        await request("/api/auth/logout",{});
        const opened=await (await request(path)).json();assert.equal(opened.generalInstructions,adminStatement.generalInstructions);
        await registerRound({...student,admin:false},round);
        await request("/api/auth/login",{username:student.username,password});
        const arena=await (await request("/api/arena?round="+round)).json();
        assert.ok(arena.assets.every((a:{phase:string})=>a.phase==="public"));
        if(spec.category==="topic") {
          assert.ok(arena.assets.some((a:{name:string;kind:string})=>a.name==="Bo_de_Regional_01.pdf"&&a.kind==="statement"));
          assert.deepEqual(arena.assets.find((a:{name:string})=>a.name==="Tac_vu_2.zip").baselineNotebooks,["baseline.ipynb"]);
        } else {
          assert.ok(!arena.assets.some((a:{name:string})=>["Huong_dan_chung.pdf","Ghi_cong_va_giay_phep.txt"].includes(a.name)));
          assert.match(opened.attributions,/Oxford-IIIT Pet/);
          for(const a of pkg.assets.filter(a=>["Huong_dan_chung.pdf","Ghi_cong_va_giay_phep.txt"].includes(a.name)))assert.equal((await request("/api/download?round="+round+"&asset="+encodeURIComponent(a.key))).status,404);
        }
        const privateAsset=pkg.assets.find(a=>a.phase==="private")!;
        assert.equal((await request("/api/download?round="+round+"&asset="+encodeURIComponent(privateAsset.key))).status,403);
        await request("/api/auth/logout",{});
      }
      checks.push("general instructions respect opening policy; regional notebook metadata and PDFs preserved; hidden guide/credit downloads blocked; private assets remain locked");
    }
    const proof={result:"PASS",checks,localSQL:true,realEmailsSent:0,productionWrites:0};
    await writeFile(".local/round-groups-qa.json",JSON.stringify(proof,null,2));
    await writeFile(".local/round-groups-fixture.json",JSON.stringify({ns,base,password,admin:admin.username,student:student.username,ids,packageId}));
    console.log(JSON.stringify(proof));
    if(process.argv.includes("--keep")){await query("delete from arena.rate_counters where ns=$1",[ns]);stopper.listen(3134,"127.0.0.1");await once(stopper,"listening");console.log("Round group QA ready at "+base);await new Promise<void>(r=>{stop=r;process.once("SIGINT",r);});}
  } finally {
    app.kill();stopper.close();
    assert.match(ns,/^arena:qa:round-groups:/);
    await sqlTransaction(async c=>{const first=["auth_identities","team_members","team_invites","admins"];for(const t of [...first,...Object.keys(importColumns).filter(t=>!first.includes(t)),"migration_runs","state"])await c.query(`delete from arena.${t} where ns=$1`,[ns]);},true);
    await closeSqlPools();
  }
}
main().catch(e=>{console.error(e instanceof Error?e.stack:"Round group QA failed");process.exitCode=1;});
