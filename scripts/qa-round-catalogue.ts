/** Isolated SQL/Redis fixture; never imports real packages or calls a GPU provider. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { namespace, sqlTransaction, closeSqlPools } from "../src/lib/sql";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { createSqlUser, saveSqlPackage, readRoundIds, readPackage, readRegistrations } from "../src/lib/entity-repository";
import { createRound, control, getContest, snapshot, registerRound } from "../src/lib/rounds";
import { manageRound } from "../src/lib/round-management";
import type { ContestPackage, User } from "../src/lib/types";
const file=".local/qa-round-catalogue.json";
async function main() {
  const mode=process.argv[2]??"setup";
  if(mode==="redis") {
    process.env.ARENA_DATABASE_MODE="redis";
    process.env.ARENA_NAMESPACE=`arena:qa:catalogue-redis:${randomUUID()}`;
    const { key }=await import("../src/lib/db");
    try {
      const pkg:ContestPackage={version:"arena-01-standardized-qa",title:"Bộ đề 01",statement:"",assets:[],judges:{"1":{public:"qa",private:"qa"},"2":{public:"qa",private:"qa"}},importedAt:Date.now()};
      await db().set(key(`package:${pkg.version}`),pkg);
      const a=await createRound("Vòng Redis A",pkg.version),b=await createRound("Vòng Redis B",pkg.version);
      const ids=await readRoundIds();
      await manageRound(a.id,{action:"move",direction:"up",expectedOrder:ids});
      assert.equal((await readRoundIds())[0],a.id);
      await assert.rejects(()=>manageRound(a.id,{action:"move",direction:"up",expectedOrder:ids}),/vừa thay đổi/);
      const c=await getContest(a.id);
      const results=await Promise.allSettled(["Tên Redis 1","Tên Redis 2"].map(title=>manageRound(a.id,{action:"rename",runId:c.id,revision:c.revision??0,title})));
      assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
      const current=await getContest(a.id);
      await manageRound(a.id,{action:"delete",runId:current.id,revision:current.revision??0,confirmTitle:current.title});
      assert.deepEqual(await readRoundIds(),[b.id]);await assert.rejects(()=>getContest(a.id),/Không tìm thấy/);
      console.log("PASS Redis fallback: order CAS, concurrent rename, soft deletion, inaccessible deleted round.");
    } finally {
      const ns=namespace();assert.match(ns,/^arena:qa:catalogue-redis:[\w-]+$/);
      let cursor="0";const keys:string[]=[];
      do {const [next,found]=await db().scan(cursor,{match:ns+":*",count:100});keys.push(...found);cursor=String(next);}while(cursor!=="0");
      for(const k of keys) assert.ok(k.startsWith(ns+":"));if(keys.length) await db().del(...keys);
    }
    return;
  }
  process.env.ARENA_DATABASE_MODE="postgres";
  if(mode==="setup") {
    assert.equal(await readFile(file,"utf8").then(()=>true,()=>false),false,"Clean the previous QA fixture first");
    process.env.ARENA_NAMESPACE=`arena:qa:catalogue:${randomUUID()}`;
    const password=randomBytes(20).toString("base64url"), hash=await hashPassword(password);
    const user=(username:string):User=>({id:randomUUID(),username,name:username,password:hash,teamId:null,createdAt:Date.now()});
    const admin=user("qa_catalogue_admin"),student=user("qa_catalogue_student");
    await mkdir(".local",{recursive:true});
    await writeFile(file,JSON.stringify({namespace:namespace(),password,adminId:admin.id,studentId:student.id,roundIds:[]}));
    await createSqlUser(admin,"primary");await createSqlUser(student);
    const tasks:ContestPackage["tasks"]=[{id:"1",title:"Dự báo chuỗi thời gian",content:"Nội dung đề giả QA"},{id:"2",title:"Phân loại văn bản",content:"Nội dung đề giả QA"}];
    const pkg=(version:string,importedAt:number):ContestPackage=>({version,title:"Bộ đề 01",statement:"",tasks,...(version.endsWith("current")?{baselineScores:{public:{"1":20,"2":10},private:{"1":22,"2":12}}}:{}),assets:[],judges:{"1":{public:"qa",private:"qa"},"2":{public:"qa",private:"qa"}},importedAt});
    for(const p of [pkg("arena-01-clean-old",1),pkg("arena-01-standardized-first",1000),pkg("arena-01-standardized-current",2000)]) await saveSqlPackage(p);
    const a=await createRound("Vòng QA đang mở","arena-01-standardized-current");
    const b=await createRound("Vòng QA chờ mở","arena-01-clean-old");
    const safe={...student,admin:false};await registerRound(safe,a.id);
    await control("start",{},a.id);
    const c=await getContest(a.id);
    const changes=await Promise.allSettled([
      manageRound(a.id,{action:"rename",runId:c.id,revision:c.revision??0,title:"Vòng QA đổi tên"}),
      manageRound(a.id,{action:"rename",runId:c.id,revision:c.revision??0,title:"Vòng QA đổi tên khác"}),
    ]);
    assert.equal(changes.filter(r=>r.status==="fulfilled").length,1);
    let ids=await readRoundIds();
    const moved=await Promise.allSettled([
      manageRound(a.id,{action:"move",direction:"up",expectedOrder:ids}),
      manageRound(a.id,{action:"move",direction:"up",expectedOrder:ids}),
    ]);
    assert.equal(moved.filter(r=>r.status==="fulfilled").length,1);
    ids=await readRoundIds();assert.equal(ids[0],a.id);
    const ss=await snapshot(safe);
    assert.equal(ss.rounds.find(r=>r.id===a.id)!.taskTitles.length,2);
    assert.equal(ss.rounds.find(r=>r.id===b.id)!.taskTitles.length,0);
    assert.equal(JSON.stringify(ss).includes("Bộ đề nguồn"),false);
    assert.equal("packageTitle" in ss.rounds[0],false);
    const deleted=await createRound("Vòng QA sẽ xóa","arena-01-clean-old");
    const dc=await getContest(deleted.id);await registerRound(safe,deleted.id);
    await manageRound(deleted.id,{action:"delete",runId:dc.id,revision:dc.revision??0,confirmTitle:dc.title});
    await assert.rejects(()=>getContest(deleted.id),/Không tìm thấy/);
    assert.equal((await readRoundIds()).includes(deleted.id),false);
    assert.ok(await readPackage(dc.packageId));assert.equal(Object.keys(await readRegistrations(dc)).length,1);
    await mkdir(".local",{recursive:true});
    await writeFile(file,JSON.stringify({namespace:namespace(),password,adminId:admin.id,studentId:student.id,roundIds:ids}));
    console.log("PASS SQL/Redis: concurrent rename/order reject stale writes; open/waiting task visibility; deletion preserves registration/package and returns 404. Fixture ready on port 3018.");
  } else {
    const fixture=JSON.parse(await readFile(file,"utf8"));
    assert.match(fixture.namespace,/^arena:qa:catalogue:[\w-]+$/);
    process.env.ARENA_NAMESPACE=fixture.namespace;
    if(mode==="serve") {
      const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3018"],{env:process.env,stdio:"inherit",windowsHide:true});
      child.on("exit",code=>{process.exitCode=code??1;});return;
    }
    assert.equal(mode,"cleanup");
    const ns=namespace();
    await sqlTransaction(async client=>{
      for(const table of ["sessions","rate_counters","admins","registrations","users","packages","rounds","runs","requests","state"])
        await client.query(`delete from arena.${table} where ns=$1`,[ns]);
    },true);
    let cursor="0";const keys:string[]=[];
    do {const [next,found]=await db().scan(cursor,{match:ns+":*",count:100});keys.push(...found);cursor=String(next);}while(cursor!=="0");
    for(const key of keys) assert.ok(key.startsWith(ns+":"));
    if(keys.length) await db().del(...keys);
    await unlink(file);console.log("QA namespace and local credentials cleaned.");
  }
  await closeSqlPools();
}
main().catch(e=>{console.error(e instanceof Error?e.message:"QA failed");process.exitCode=1;});
