/** Real Supabase + Redis, unique QA namespace. No provider calls or paid resources. */
import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import { namespace,query,sqlTransaction,sqlNow,closeSqlPools } from "../src/lib/sql";
import { db,key } from "../src/lib/db";
import { createSqlUser,readUser,readTeams,readSubmissions,saveSqlPackage,readRegistration } from "../src/lib/entity-repository";
import { sqlTeamAction } from "../src/lib/sql-teams";
import { createRound,registerRound,control,getContest } from "../src/lib/rounds";
import { commitSqlSubmission } from "../src/lib/sql-rounds";
import { runtimeEval,readRuntimeHistory,readChatContext,readChatJob,syncRuntimeHistory } from "../src/lib/runtime-authority";
import { exportSqlSnapshot,restoreBusinessToRedis } from "../src/lib/database-rollback";
import { saveEncryptedSnapshot,loadEncryptedSnapshot,planSnapshot } from "../src/lib/database-snapshot";
import { encryptSecret } from "../src/lib/workspace-crypto";
import { defaultTemplate,type Workspace } from "../src/lib/workspace-domain";
import { saveTemplate,saveCredential,deployWorkspace } from "../src/lib/workspaces";
import { authorizeHub,redeemHub,receiveHubReport } from "../src/lib/hub-service";
import { enqueueChat,workerAction,jobKey } from "../src/lib/chat-queue";
import type { User,SafeUser,Submission,ContestPackage } from "../src/lib/types";

async function main() {
  assert.ok(process.env.ARENA_DATABASE_URL,"Use --env-file=.local/supabase-runtime.env");
  process.env.ARENA_DATABASE_MODE="postgres";
  process.env.ARENA_RUNPOD_MODE="enabled";
  process.env.ARENA_NAMESPACE=`arena:qa:sql:${randomUUID()}`;
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY=randomBytes(32).toString("base64");
  process.env.GPU_WORKSPACE_PUBLIC_URL="https://qa.example.test";
  const ns=namespace(),checks:string[]=[];
  const user=(name:string):User=>({id:randomUUID(),username:name,name,password:"qa-hash-never-used-for-login",teamId:null,createdAt:Date.now()});
  const admin=user("sql_admin"),people=Array.from({length:5},(_,i)=>user(`sql_user_${i}`));
  try {
    await query("insert into arena.state(ns,imported_at) values($1,$2)",[ns,Date.now()]);
    // The same backend role cannot see another namespace through the pool.
    assert.equal((await query("select count(*)::int as n from arena.state where ns<>$1",[ns]))[0].n,0);
    await createSqlUser(admin,"primary");
    const duplicate=await Promise.all(Array.from({length:6},()=>createSqlUser(user("same_name"))));
    assert.equal(duplicate.filter(Boolean).length,1); checks.push("namespace RLS and concurrent username uniqueness");
    for(const u of people) await createSqlUser(u);
    await sqlTeamAction(people[0].id,"create",{name:"SQL QA team"});
    const team=Object.values(await readTeams())[0];
    const joined=await Promise.allSettled(people.slice(1).map(u=>sqlTeamAction(u.id,"join",{code:team.inviteCode})));
    assert.equal(joined.filter(r=>r.status==="fulfilled").length,2);
    assert.equal((await readTeams())[team.id].members.length,3); checks.push("atomic team capacity and membership");
    const pkg:ContestPackage={version:`sql-qa-${randomUUID()}`,title:"SQL QA",statement:"# SQL QA",
      tasks:[{id:"1",title:"Task 1",content:"QA"},{id:"2",title:"Task 2",content:"QA"},{id:"3",title:"Task 3",content:"QA"}],
      assets:[],judges:{"1":{public:"qa",private:"qa"},"2":{public:"qa",private:"qa"}},importedAt:Date.now()};
    await saveSqlPackage(pkg);
    const {id:roundId}=await createRound("SQL QA round",pkg.version);
    const member=(await readUser(people[0].id))!;
    const safe:SafeUser={...member,admin:false};
    await registerRound(safe,roundId); assert.equal((await readRegistration(await getContest(roundId),member.id))?.status,"approved");
    await control("configure",{title:"SQL QA round",publicSeconds:18000,privateSeconds:3600,publicLimit:2,privateLimit:2},roundId);
    await control("start",{},roundId);
    let c=await getContest(roundId);
    const submission=():Submission=>({id:randomUUID(),runId:c.id,teamId:team.id,userId:member.id,task:"3",split:"public",filename:"qa.csv",
      createdAt:Date.now(),score:12.3456789012345,secondary:0.12345,bytes:10,sha256:"qa",path:"qa/no-upload.csv",note:"",status:"accepted",adminTest:false});
    const raced=await Promise.allSettled(Array.from({length:6},()=>commitSqlSubmission(submission(),roundId,randomUUID())));
    assert.equal(raced.filter(r=>r.status==="fulfilled").length,2);
    assert.equal((await readSubmissions(c.id)).length,2);
    assert.equal((await readSubmissions(c.id))[0].score,12.3456789012345);
    assert.equal(Number((await query("select used from arena.submission_quotas where ns=$1 and run_id=$2",[ns,c.id]))[0].used),2);
    const invalid={...submission(),status:"invalid" as const,error:"QA invalid"},nonce=randomUUID();
    const repeated=await Promise.all(Array.from({length:4},()=>commitSqlSubmission({...invalid,id:randomUUID()},roundId,nonce)));
    assert.equal(new Set(repeated).size,1);assert.equal((await readSubmissions(c.id)).length,3);
    assert.equal(Number((await query("select used from arena.submission_quotas where ns=$1 and run_id=$2",[ns,c.id]))[0].used),2);
    checks.push("task 3, quota races, invalid submissions and idempotent receipts");
    const oldRun=c.id;
    await control("reset-round",{runId:c.id,revision:c.revision??0,requestId:randomUUID(),keepLeaderboard:true},roundId);
    c=await getContest(roundId);assert.equal(c.id,oldRun);assert.equal((await readSubmissions(c.id)).length,3);
    await control("practice-open",{runId:c.id,revision:c.revision??0,requestId:randomUUID(),endAt:null,publicVisible:true,privateVisible:true,chatbotEnabled:true,chatbotUntil:null,notebookEnabled:true},roundId);
    await assert.rejects(()=>commitSqlSubmission(submission(),roundId,randomUUID()),/hết lượt/);
    c=await getContest(roundId);
    await control("reset-round",{runId:c.id,revision:c.revision??0,requestId:randomUUID(),keepLeaderboard:false},roundId);
    c=await getContest(roundId);assert.notEqual(c.id,oldRun);assert.equal((await readSubmissions(c.id)).length,0);
    assert.equal((await readSubmissions(oldRun)).length,3);checks.push("reset keep/clear preserves old runs and used quota");
    // A forged/stale legacy Redis authority cannot grant an SQL role.
    await db().sadd(key("admins"),member.id);
    const role=await runtimeEval<unknown[],number>("return redis.call('SISMEMBER',KEYS[1],ARGV[1])",[key("admins")],[member.id]);
    assert.equal(role,0);assert.equal(await db().sismember(key("admins"),member.id),1);
    checks.push("SQL authority rejects stale Redis roles without modifying legacy data");
    await control("practice-open",{runId:c.id,revision:c.revision??0,requestId:randomUUID(),endAt:null,publicVisible:true,privateVisible:true,chatbotEnabled:true,chatbotUntil:null,notebookEnabled:true},roundId);
    c=await getContest(roundId);
    const template={...defaultTemplate,id:randomUUID(),name:"SQL runtime QA",services:"llm" as const,imageName:"qa/image:test",tokenLimitMode:"session" as const,inputTokenLimit:512,outputTokenLimit:256,sessionTokenLimit:1024,llmParallel:1 as const};
    await saveTemplate(template,admin.id);
    const adminSafe:SafeUser={...admin,admin:true};
    const originalFetch=globalThis.fetch;let creates=0;
    globalThis.fetch=async(input,init)=>{
      const url=String(input),json=(v:unknown)=>new Response(JSON.stringify(v),{status:200,headers:{"Content-Type":"application/json"}});
      if(url==="https://api.runpod.io/v2/catalog/gpus")return json({gpus:[{id:"NVIDIA A40",name:"A40",memory:48,price:{secure:0.5,community:0.5}}]});
      if(url==="https://api.runpod.io/graphql") {
        const body=JSON.parse(String(init?.body));
        if(body.query.includes("ArenaCreate")){creates++;return json({data:{podFindAndDeployOnDemand:{id:"qafakecreated",name:body.variables.input.name,desiredStatus:"RUNNING",costPerHr:0.5}}});}
        if(body.query.includes("ArenaPods"))return json({data:{myself:{pods:[]}}});
        throw new Error("Unexpected QA provider query");
      }
      if(url.startsWith(process.env.UPSTASH_REDIS_REST_URL!))return originalFetch(input,init);
      throw new Error("Unexpected outbound request blocked by SQL QA");
    };
    try {
      await saveCredential(adminSafe,"sql-qa-provider-stub-only");
      const allocations=await Promise.allSettled(Array.from({length:4},()=>deployWorkspace(adminSafe,team.id,roundId,template.id,1,{services:"llm",loadDataset:false,requestId:randomUUID()})));
      assert.equal(creates,1);assert.equal(allocations.filter(r=>r.status==="fulfilled").length,1);
      checks.push("concurrent SQL-backed GPU reservation creates one mocked allocation with no real provider calls");
    } finally {globalThis.fetch=originalFetch;}
    const token=randomBytes(32).toString("base64url"),now=await sqlNow();
    const w:Workspace={id:randomUUID(),teamId:null,scope:"all",services:"llm",teamName:"All QA",roundId,runId:c.id,roundTitle:c.title,ownerId:admin.id,
      podName:"qa-only",podId:"qafakepod",status:"running",template,secret:encryptSecret(token),jupyterSecret:encryptSecret("qa"),createdAt:now,updatedAt:now,
      syncedAt:now,meterAt:now,meterRate:0,accruedUsd:0,quotedGpuRate:0,health:null,error:null,contextWindowTokens:1152};
    await runtimeEval("redis.call('SET',KEYS[1],ARGV[1]);redis.call('SADD',KEYS[2],ARGV[2]);return 1",[key(`gpu:workspace:${w.id}`),key("gpu:workspaces")],[JSON.stringify(w),w.id]);
    const session=randomUUID(),requestId=randomUUID();
    await enqueueChat(safe,w.id,session,requestId,"SQL runtime QA prompt");
    const base={workspaceId:w.id,protocol:2,ready:true,fingerprint:"qa-fingerprint",slot:0,capacity:1};
    const claimed=await workerAction("claim",base,`Bearer ${token}`) as {job:{requestId:string;attempt:string}};
    assert.equal(claimed.job.requestId,requestId);
    const attempt={...base,requestId,attempt:claimed.job.attempt};
    const prepared=await workerAction("prepare",{...attempt,promptTokens:12},`Bearer ${token}`) as {execute:boolean};assert.equal(prepared.execute,true);
    const completed=await workerAction("complete",{...attempt,inputTokens:12,outputTokens:5,content:"QA output"},`Bearer ${token}`) as {accepted:boolean};
    assert.equal(completed.accepted,true);
    assert.equal((await readRuntimeHistory<{id:string;status:string}>("chat-job",requestId))[0].status,"completed");
    assert.ok((await readRuntimeHistory("chat-session")).length>0);checks.push("real SQL/Redis queue claim, reservation, completion and durable history");
    const storedJob=(await db().get<{sessionKey:string}>(jobKey(requestId)))!;
    const originalContext=await db().get(storedJob.sessionKey),ttl=await db().pttl(storedJob.sessionKey);
    await db().del(storedJob.sessionKey,jobKey(requestId));
    assert.deepEqual(await readChatContext(storedJob.sessionKey),originalContext);
    assert.ok(await db().pttl(storedJob.sessionKey)<=ttl);
    assert.equal((await readChatJob<{status:string}>(jobKey(requestId)))?.status,"completed");
    assert.equal(await db().exists(jobKey(requestId)),0);
    assert.equal((await enqueueChat(safe,w.id,session,requestId,"SQL runtime QA prompt")).requestId,requestId);
    assert.equal(await db().exists(jobKey(requestId)),0);
    checks.push("cache eviction preserves chat context, token budget and request idempotency without reviving worker jobs");
    await assert.rejects(()=>sqlTransaction(async()=>{
      await runtimeEval("local w=cjson.decode(redis.call('GET',KEYS[1]));w.error='QA replay marker';redis.call('SET',KEYS[1],cjson.encode(w));return 1",[key(`gpu:workspace:${w.id}`)],[]);
      throw new Error("QA simulated lost SQL transaction");
    },true),/QA simulated/);
    assert.ok(await db().hlen(key("sql:runtime:pending"))>0);
    // SQL reads no longer depend on Redis. Replay belongs to Runpod operations.
    await syncRuntimeHistory();
    assert.equal((await readRuntimeHistory<{error:string}>("workspace",w.id))[0].error,"QA replay marker");
    assert.equal(await db().hlen(key("sql:runtime:pending")),0);
    checks.push("runtime changes survive SQL rollback through idempotent history replay");
    const hubId=randomUUID(),revision=randomUUID();
    const hub:Workspace={...w,id:hubId,services:"jupyter",jupyterMode:"team-hub",hubTeams:{[team.id]:{teamId:team.id,teamName:team.name,enabled:true,desiredState:"running",revision,updatedAt:now}}};
    await runtimeEval("redis.call('SET',KEYS[1],ARGV[1]);redis.call('SADD',KEYS[2],ARGV[2]);return 1",[key(`gpu:workspace:${hubId}`),key("gpu:workspaces")],[JSON.stringify(hub),hubId]);
    await receiveHubReport(hubId,`Bearer ${token}`,{runId:c.id,hubReady:true,resources:{availableRAMGiB:40,freeDiskGiB:80},notebooks:[{teamId:team.id,revision,state:"ready",publicReady:true,privateReady:false}]});
    const state=randomUUID(),ticket=await authorizeHub(safe,hubId,state);assert.ok(ticket.url);
    const code=new URL(ticket.url).searchParams.get("ticket")!;
    await assert.rejects(()=>redeemHub(hubId,`Bearer ${token}`,code,"wrong-state"));
    assert.equal((await redeemHub(hubId,`Bearer ${token}`,code,state)).teamId,team.id);
    await assert.rejects(()=>redeemHub(hubId,`Bearer ${token}`,code,state));
    checks.push("Hub login tickets enforce SQL membership, callback state and one-time redemption");
    const lateId=randomUUID();await enqueueChat(safe,w.id,session,lateId,"Late QA prompt");
    const late=await workerAction("claim",base,`Bearer ${token}`) as {job:{attempt:string}};
    const lateAttempt={...base,requestId:lateId,attempt:late.job.attempt};
    await workerAction("prepare",{...lateAttempt,promptTokens:20},`Bearer ${token}`);
    c=await getContest(roundId);
    await control("chatbot-access",{runId:c.id,revision:c.revision??0,requestId:randomUUID(),enabled:false,until:null},roundId);
    const cancelled=await workerAction("complete",{...lateAttempt,inputTokens:20,outputTokens:4,content:"Must not publish"},`Bearer ${token}`) as {accepted:boolean};
    assert.equal(cancelled.accepted,false);checks.push("SQL permission revocation fences an in-flight model response");
    const backup=`.local/database-backups/qa-rollback-${randomUUID()}.json.enc`;
    const snapshot=await sqlTransaction(()=>exportSqlSnapshot(),true);
    await saveEncryptedSnapshot(snapshot,backup);
    const decoded=await loadEncryptedSnapshot(backup);assert.equal(decoded.checksum,snapshot.checksum);
    const rollbackNs=ns+":restore";
    await db().set(rollbackNs+":gpu:qa-runtime-sentinel","preserve-runtime");
    const restored=await restoreBusinessToRedis(decoded,rollbackNs);
    assert.equal(restored.verified,true);assert.equal(await db().get(rollbackNs+":gpu:qa-runtime-sentinel"),"preserve-runtime");
    assert.equal(planSnapshot(decoded).issues.length,0);
    assert.equal(planSnapshot(decoded).counts.submissions,3);
    assert.equal(planSnapshot(decoded).counts.gpu_templates,1);
    checks.push("encrypted SQL backup and verified business restore preserve current runtime state");
    const proof={result:"PASS",namespace:ns,checks,realSupabase:true,realRedis:true,providerCalls:0,paidResources:0};
    await mkdir(".local",{recursive:true});await writeFile(".local/supabase-qa-result.json",JSON.stringify(proof,null,2));
    console.log(JSON.stringify(proof));
  } finally {
    assert.ok(namespace()===ns&&ns.startsWith("arena:qa:sql:"));
    const tables=["sessions","rate_counters","runtime_leases","runtime_signals","chat_lanes","submission_files","team_members","team_invites","admins","users","teams","packages","rounds","runs","registrations","announcements","submissions","submission_quotas","requests","gpu_templates","gpu_credentials","api_credentials","runtime_history","audit_events","legacy_archive","migration_runs","state"];
    await sqlTransaction(async client=>{for(const t of tables) await client.query(`delete from arena.${t} where ns=$1`,[ns]);},true);
    let cursor="0";const keys:string[]=[];do{const [next,found]=await db().scan(cursor,{match:ns+":*",count:100});keys.push(...found);cursor=String(next);}while(cursor!=="0");
    for(const k of keys) assert.ok(k.startsWith(ns+":"));
    for(let i=0;i<keys.length;i+=100) await db().del(...keys.slice(i,i+100));
    await closeSqlPools();
  }
}
main().catch(e=>{console.error(e instanceof Error?e.stack:"SQL QA failed");process.exitCode=1;});
