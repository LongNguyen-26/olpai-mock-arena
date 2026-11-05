/** Real Supabase + Redis in an isolated namespace; all Groq inference is mocked. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db, key } from "../src/lib/db";
import { namespace, query, sqlTransaction, closeSqlPools } from "../src/lib/sql";
import { createSqlUser, saveSqlPackage, readUser } from "../src/lib/entity-repository";
import { sqlTeamAction } from "../src/lib/sql-teams";
import { createRound, control, getContest, registerRound } from "../src/lib/rounds";
import { createGroqChatbot, changeGroqCredential, groqCredentialState } from "../src/lib/groq-service";
import { readApiCredential } from "../src/lib/api-credentials";
import { controlChatGroup, chatGroupViews } from "../src/lib/chat-groups";
import { enqueueChat, readQueuedChat, jobKey, groqQueueAction, settleUncertain, type ChatJob } from "../src/lib/chat-queue";
import { pumpGroqGroup } from "../src/lib/groq-runner";
import { exportSqlSnapshot } from "../src/lib/database-rollback";
import { planSnapshot } from "../src/lib/database-snapshot";
import type { ContestPackage, User, SafeUser } from "../src/lib/types";

async function main() {
  process.env.ARENA_DATABASE_MODE = "postgres";
  process.env.ARENA_NAMESPACE = `arena:qa:groq:${randomUUID()}`;
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  await mkdir(".local",{recursive:true});await writeFile(".local/groq-qa-active.json",JSON.stringify({namespace:namespace()}));
  const ns = namespace(), original = globalThis.fetch, checks: string[] = [];
  let calls = 0, behavior: "ok" | "429" | "401" | "timeout" | "late" | "parallel" = "ok";
  const parallelWaiters: (() => void)[] = [];
  let late: (() => void) | undefined;
  let started: (() => void) | undefined;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://api.groq.com/")) return original(url, init);
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "openai/gpt-oss-20b", context_window: 131072, max_completion_tokens: 65536 }] });
    calls++; started?.();
    if (behavior === "parallel") await new Promise<void>(r=>{parallelWaiters.push(r);if(parallelWaiters.length===2)parallelWaiters.splice(0).forEach(done=>done());});
    if (behavior === "429") return new Response("never log this", { status: 429, headers: { "retry-after": "1" } });
    if (behavior === "401") return new Response("never log this", { status: 401 });
    if (behavior === "timeout") throw new Error("Simulated lost acknowledgement");
    if (behavior === "late") await new Promise<void>(r => { late = r; });
    return Response.json({ id: `qa-completion-${calls}`, choices: [{ message: { content: "QA answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
  };
  const user = (name: string): User => ({ id: randomUUID(), username: name, name, password: "qa-only-hash", teamId: null, createdAt: Date.now() });
  const a = user("groq_admin"), b = user("groq_other_admin"), m = user("groq_member"), stranger = user("groq_stranger");
  const admin: SafeUser = { ...a, admin: true }, other: SafeUser = { ...b, admin: true };
  try {
    await query("insert into arena.state(ns,imported_at) values($1,$2)", [ns, Date.now()]);
    await createSqlUser(a,"primary"); await createSqlUser(b,"additional"); await createSqlUser(m); await createSqlUser(stranger);
    await sqlTeamAction(m.id,"create",{ name: "Groq QA team" });
    const member: SafeUser = { ...(await readUser(m.id))!, admin: false };
    const outsider: SafeUser = { ...stranger, admin: false };
    const pkg: ContestPackage = { version: randomUUID(), title: "Groq QA", statement: "QA", tasks: [{ id:"1",title:"Task",content:"QA" }], assets: [], judges:{ "1":{ public:"qa",private:"qa" }, "2":{ public:"qa",private:"qa" } }, importedAt: Date.now() };
    await saveSqlPackage(pkg);
    const { id: roundId } = await createRound("Groq QA",pkg.version);
    await registerRound(member,roundId); await control("start",{},roundId);
    await changeGroqCredential(admin,"gsk_fake_key_qa_never_real");
    assert.ok((await readApiCredential(a.id))?.ciphertext); assert.equal((await groqCredentialState(other)).configured,false);
    await assert.rejects(() => changeGroqCredential(member,"gsk_fake_key_qa_never_real"), /Chỉ admin/);
    checks.push("encrypted per-admin keys and server-side role checks");
    const input = { id: randomUUID(), name: "Groq QA chatbot", model: "openai/gpt-oss-20b", scope: "team" as const, teamId: member.teamId, roundId,
      policy: { tokenLimitMode: "turn" as const, sessionTokenLimit: 2000, inputTokenLimit: 1800, outputTokenLimit: 1024 }, parallel: 2, requestsPerMinute: 1000 };
    const deployed = await Promise.allSettled(Array.from({length:4}, () => createGroqChatbot(admin,input)));
    assert.ok(deployed.some(v=>v.status==="fulfilled"));
    for (const r of deployed) if (r.status==="rejected") assert.match(r.reason.message,/đang được cập nhật/);
    assert.equal((await createGroqChatbot(admin,input)).id,input.id);
    await assert.rejects(() => createGroqChatbot(admin,{...input,id:randomUUID()}), /đã có Chatbot/);
    await assert.rejects(() => readQueuedChat(outsider,undefined,randomUUID(),input.id), /không thuộc đội/);
    await assert.rejects(() => controlChatGroup(other,input.id,"pause"), /quản trị viên khác/);
    checks.push("concurrent idempotent allocation, one service reservation and team ownership");
    const c = await getContest(roundId), session = randomUUID(), request = randomUUID();
    await Promise.all(Array.from({length:4},()=>enqueueChat(member,undefined,session,request,"Hello",input.id,c.id)));
    await pumpGroqGroup(input.id,true);
    let result = await readQueuedChat(member,undefined,session,input.id);
    assert.equal(calls,1); assert.equal(result.session.messages.length,2); assert.equal(result.session.inputTokens,20); assert.equal(result.session.outputTokens,10);
    await pumpGroqGroup(input.id,true); assert.equal(calls,1);
    checks.push("duplicate prompts execute once; provider usage replaces conservative reservation");
    if(process.argv.includes("--smoke")) {
      const [,rateKeys]=await db().scan(0,{match:key("groq:rate:*") ,count:100});
      assert.ok(rateKeys.length>0);const counts=await db().mget<number[]>(...rateKeys);
      assert.equal(counts.reduce((sum,n)=>sum+Number(n),0),1,"Idle slots must not consume provider RPM");
      const proof={result:"PASS",checks:[...checks,"empty queue and unused slots consume no provider RPM"],realSupabase:true,realRedis:true,mockedGroqRequests:calls};
      await writeFile(".local/groq-smoke-result.json",JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));return;
    }

    behavior="parallel";
    const burstSessions=Array.from({length:4},()=>randomUUID());
    await Promise.all(burstSessions.map(s=>enqueueChat(member,undefined,s,randomUUID(),"Parallel",input.id,c.id)));
    await assert.rejects(()=>enqueueChat(member,undefined,randomUUID(),randomUUID(),"Fifth",input.id,c.id),/4 prompt/);
    await pumpGroqGroup(input.id,true);await pumpGroqGroup(input.id,true);
    for(const s of burstSessions)assert.equal((await readQueuedChat(member,undefined,s,input.id)).session.messages.length,2);
    checks.push("two concurrent slots process independent sessions; team pending cap is atomic");
    behavior="ok";
    const beforeLarge=calls,largeSession=randomUUID();await enqueueChat(member,undefined,largeSession,randomUUID(),"x".repeat(5000),input.id,c.id);await pumpGroqGroup(input.id,true);
    assert.equal(calls,beforeLarge);assert.equal((await readQueuedChat(member,undefined,largeSession,input.id)).session.inputTokens,0);
    checks.push("oversized prompts are rejected before a provider call");
    await assert.rejects(() => changeGroqCredential(admin,null), /Tạm ngừng/);
    const isolated = await readQueuedChat(member,undefined,randomUUID(),input.id); assert.equal(isolated.session.messages.length,0);
    behavior="429";
    const retrySession=randomUUID(),retryId=randomUUID();await enqueueChat(member,undefined,retrySession,retryId,"Rate limit",input.id,c.id);await pumpGroqGroup(input.id,true);
    result=await readQueuedChat(member,undefined,retrySession,input.id);assert.equal(result.session.inputTokens,0);assert.equal(result.session.outputTokens,0);
    assert.equal((await db().get<ChatJob>(jobKey(retryId)))?.status,"queued");
    behavior="ok";await new Promise(r=>setTimeout(r,1100));await pumpGroqGroup(input.id,true);
    assert.equal((await readQueuedChat(member,undefined,retrySession,input.id)).session.messages.length,2);
    checks.push("429 refunds reservation and retries through key-wide backoff");
    behavior="401";const rejectedSession=randomUUID();await enqueueChat(member,undefined,rejectedSession,randomUUID(),"Rejected",input.id,c.id);await pumpGroqGroup(input.id,true);
    result=await readQueuedChat(member,undefined,rejectedSession,input.id);assert.equal(result.session.inputTokens+result.session.outputTokens,0);assert.ok(result.session.error);
    checks.push("definite provider rejection consumes no token budget");
    behavior="429";const boundedId=randomUUID();await enqueueChat(member,undefined,randomUUID(),boundedId,"Bounded retry",input.id,c.id);
    for(let n=0;n<3;n++){await new Promise(r=>setTimeout(r,1100));await pumpGroqGroup(input.id,true);}
    assert.equal((await db().get<ChatJob>(jobKey(boundedId)))?.status,"failed");checks.push("persistent 429 stops after three definite rejections");
    await new Promise(r=>setTimeout(r,1100));

    behavior="timeout";const uncertainId=randomUUID(),uncertainSession=randomUUID();await enqueueChat(member,undefined,uncertainSession,uncertainId,"Timeout",input.id,c.id);await pumpGroqGroup(input.id,true);
    const before=calls;await pumpGroqGroup(input.id,true);assert.equal(calls,before);assert.equal((await db().get<ChatJob>(jobKey(uncertainId)))?.status,"uncertain");
    await assert.rejects(()=>settleUncertain(other,uncertainId),/quản trị viên khác/);await settleUncertain(admin,uncertainId);
    checks.push("lost acknowledgements keep reservation and never rerun inference; settlement is owner-only");
    behavior="late";const lateSession=randomUUID();await enqueueChat(member,undefined,lateSession,randomUUID(),"Late response",input.id,c.id);
    const didStart=new Promise<void>(r=>{started=r;});const pending=pumpGroqGroup(input.id,true);await Promise.race([didStart,pending.then(()=>{throw new Error("QA late inference was not started");})]);
    const current=await getContest(roundId);await control("open-private",{runId:current.id,revision:current.revision??0,requestId:randomUUID(),lockPublic:true,revokeChatbot:true,endAt:null},roundId); late?.();await pending;started=undefined;
    result=await readQueuedChat(member,undefined,lateSession,input.id);assert.equal(result.session.messages.filter(m=>m.role==="assistant").length,0);
    checks.push("private transition blocks in-flight results");
    await controlChatGroup(admin,input.id,"pause");await changeGroqCredential(admin,null);assert.equal((await groqCredentialState(admin)).configured,false);
    await changeGroqCredential(admin,"gsk_fake_second_key_for_qa");
    const snapshot=await sqlTransaction(()=>exportSqlSnapshot(),true),plan=planSnapshot(snapshot);
    assert.equal(plan.counts.api_credentials,1);assert.equal(plan.tables.api_credentials[0][0],a.id);assert.ok(!JSON.stringify(snapshot).includes("gsk_fake_second_key_for_qa"));
    checks.push("safe key deletion/replacement and encrypted SQL backup round-trip");
    const proof={result:"PASS",namespace:ns,checks,realSupabase:true,realRedis:true,mockedGroqRequests:calls,realGroqRequests:0};
    await mkdir(".local",{recursive:true});await writeFile(".local/groq-qa-result.json",JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
  } finally {
    late?.();globalThis.fetch=original;assert.equal(namespace(),ns);assert.ok(ns.startsWith("arena:qa:groq:"));
    const tables=["team_members","team_invites","admins","users","teams","packages","rounds","runs","registrations","announcements","submissions","submission_quotas","requests","gpu_templates","gpu_credentials","api_credentials","runtime_history","audit_events","legacy_archive","migration_runs","state"];
    await sqlTransaction(async client=>{for(const t of tables)await client.query(`delete from arena.${t} where ns=$1`,[ns]);},true);
    let cursor="0";const keys:string[]=[];do{const [next,found]=await db().scan(cursor,{match:ns+":*",count:100});keys.push(...found);cursor=String(next);}while(cursor!=="0");
    for(const k of keys)assert.ok(k.startsWith(ns+":"));for(let i=0;i<keys.length;i+=100)await db().del(...keys.slice(i,i+100));await closeSqlPools();
  }
}
main().catch(e=>{console.error(e instanceof Error?e.stack:"Groq QA failed");process.exitCode=1;});
