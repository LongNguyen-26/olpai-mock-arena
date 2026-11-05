/** Real isolated SQL/Redis. The model and provider APIs are mocked. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db, key } from "../src/lib/db";
import { namespace, query, sqlTransaction, closeSqlPools } from "../src/lib/sql";
import { createSqlUser, saveSqlPackage, readUser, readTeams } from "../src/lib/entity-repository";
import { sqlTeamAction } from "../src/lib/sql-teams";
import { createRound, control, getContest } from "../src/lib/rounds";
import { hashPassword } from "../src/lib/auth";
import { createGroqChatbot, changeGroqCredential } from "../src/lib/groq-service";
import { controlChatGroup, chatGroupViews } from "../src/lib/chat-groups";
import { enqueueChat, readQueuedChat, jobKey, type ChatJob } from "../src/lib/chat-queue";
import { pumpGroqGroup } from "../src/lib/groq-runner";
import { chatHistory, readConversation } from "../src/lib/chat-history";
import { exportSqlSnapshot } from "../src/lib/database-rollback";
import { planSnapshot } from "../src/lib/database-snapshot";
import type { User, SafeUser, ContestPackage } from "../src/lib/types";
import type { ChatSession } from "../src/lib/workspace-domain";

async function main() {
  process.env.ARENA_DATABASE_MODE="postgres";process.env.ARENA_NAMESPACE=`arena:qa:chat-history:${randomUUID()}`;
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY=randomBytes(32).toString("base64");
  const ns=namespace(),original=globalThis.fetch,checks:string[]=[],password=randomBytes(16).toString("base64url");
  let calls=0,keep=false;
  globalThis.fetch=async(url,init)=>{
    if(!String(url).startsWith("https://api.groq.com/"))return original(url,init);
    if(String(url).endsWith("/models"))return Response.json({data:[{id:"openai/gpt-oss-20b",context_window:131072,max_completion_tokens:65536}]});
    calls++;return Response.json({id:`qa-history-${calls}`,choices:[{message:{content:"Phản hồi kiểm tra lịch sử"},finish_reason:"stop"}],usage:{prompt_tokens:20,completion_tokens:10}});
  };
  const user=async(name:string):Promise<User>=>({id:randomUUID(),username:name,name,password:await hashPassword(password),teamId:null,createdAt:Date.now()});
  try {
    await query("insert into arena.state(ns,imported_at) values($1,$2)",[ns,Date.now()]);
    const a=await user("history_admin"),u=await user("history_member"),v=await user("history_teammate"),x=await user("history_outsider");
    await createSqlUser(a,"primary");for(const person of [u,v,x])await createSqlUser(person);
    await sqlTeamAction(u.id,"create",{name:"Đội kiểm tra lịch sử"});
    const team=Object.values(await readTeams())[0];await sqlTeamAction(v.id,"join",{code:team.inviteCode});
    await sqlTeamAction(x.id,"create",{name:"Đội khác"});
    const admin:SafeUser={...a,admin:true},member:SafeUser={...(await readUser(u.id))!,admin:false},teammate:SafeUser={...(await readUser(v.id))!,admin:false},outsider:SafeUser={...(await readUser(x.id))!,admin:false};
    const pkg:ContestPackage={version:randomUUID(),title:"Kiểm tra lịch sử",statement:"QA",tasks:[{id:"1",title:"Tác vụ",content:"QA"}],assets:[],judges:{"1":{public:"qa",private:"qa"},"2":{public:"qa",private:"qa"}},importedAt:Date.now()};
    await saveSqlPackage(pkg);const {id:roundId}=await createRound("Vòng luyện lịch sử",pkg.version);await control("start",{},roundId);
    await changeGroqCredential(admin,"gsk_fake_history_key_for_qa");
    const allocation={id:randomUUID(),name:"Chatbot Groq QA",model:"openai/gpt-oss-20b",scope:"all" as const,teamId:null,roundId,
      policy:{tokenLimitMode:"turn" as const,sessionTokenLimit:2000,inputTokenLimit:1800,outputTokenLimit:1024},parallel:2,requestsPerMinute:1000};
    await createGroqChatbot(admin,allocation);let c=await getContest(roundId);
    const firstSession=randomUUID(),request=randomUUID();await enqueueChat(member,undefined,firstSession,request,"Câu hỏi đầu tiên của đội",allocation.id,c.id);await pumpGroqGroup(allocation.id,true);
    const history=await chatHistory(member,undefined,allocation.id);assert.equal(history.items.length,1);
    const ref=history.items[0].id;
    assert.equal((await chatHistory(teammate,undefined,allocation.id)).items[0].id,ref);
    const shared=await readConversation(teammate,ref,undefined,allocation.id);assert.equal(shared.session.messages.length,2);assert.equal(shared.session.inputTokens,20);assert.equal(shared.session.outputTokens,10);
    assert.ok(!/groq|runpod|deepseek|gpt-oss/i.test(JSON.stringify(shared)));assert.equal(shared.model,"Trợ lý AI");
    assert.equal((await chatHistory(outsider,undefined,allocation.id)).items.length,0);await assert.rejects(()=>readConversation(outsider,ref,undefined,allocation.id),/Không tìm thấy/);
    assert.equal((await chatHistory(admin,undefined,allocation.id)).items.length,0);
    const views=await chatGroupViews(member);assert.ok(!/Groq|DeepSeek|gpt-oss/.test(JSON.stringify(views)));assert.equal(views.find(g=>g.id===allocation.id)?.preparingResources,false);
    checks.push("team-shared history, cross-team reference denial, admin lane isolation and provider-free contestant DTOs");
    const job=(await db().get<ChatJob>(jobKey(request)))!;
    const rows=await query("select expires_at from arena.runtime_history where ns=$1 and kind='chat-group-session'",[ns]);assert.equal(rows[0].expires_at,null);
    const legacy=(await db().get<ChatSession>(job.sessionKey))!;delete legacy.conversation;
    await db().set(job.sessionKey,legacy,{ex:60});
    await readConversation(member,ref,undefined,allocation.id);
    assert.equal((await db().get<ChatSession>(job.sessionKey))!.conversation?.title,"Câu hỏi đầu tiên của đội");
    assert.equal(await db().pttl(job.sessionKey),-1);
    await db().del(job.sessionKey);const restored=await readConversation(member,ref,undefined,allocation.id);assert.equal(restored.session.messages.length,2);assert.equal(calls,1);
    checks.push("permanent SQL snapshot restores evicted cache without inference or token reset");
    const secondSession=randomUUID();await enqueueChat(teammate,undefined,secondSession,randomUUID(),"Một cuộc trò chuyện khác",allocation.id,c.id);await pumpGroqGroup(allocation.id,true);
    assert.equal((await chatHistory(member,undefined,allocation.id)).items.length,2);assert.equal((await readConversation(member,ref,undefined,allocation.id)).session.messages.length,2);
    checks.push("new chat preserves prior conversations and each conversation token ledger");
    await control("finish",{},roundId);assert.equal((await chatHistory(member,undefined,allocation.id)).items.length,2);assert.equal((await readConversation(member,ref,undefined,allocation.id)).enabled,false);
    c=await getContest(roundId);await control("reset-round",{runId:c.id,revision:c.revision??0,requestId:randomUUID(),keepLeaderboard:false},roundId);
    c=await getContest(roundId);await control("practice-open",{runId:c.id,revision:c.revision??0,requestId:randomUUID(),endAt:null,publicVisible:true,privateVisible:true,chatbotEnabled:true,chatbotUntil:null,notebookEnabled:true},roundId);
    const archived=await readConversation(member,ref,undefined,allocation.id);assert.equal(archived.readOnly,true);assert.equal(archived.session.inputTokens,20);assert.equal(archived.enabled,false);
    checks.push("finished rounds and reset retain history; previous runs are read-only with original usage");
    const third=randomUUID();await enqueueChat(member,undefined,third,randomUUID(),"Câu hỏi ở lượt luyện mới",allocation.id,c.id);await pumpGroqGroup(allocation.id,true);
    const active=await readQueuedChat(member,undefined,third,allocation.id);assert.equal(active.session.inputTokens,20);assert.equal((await chatHistory(member,undefined,allocation.id)).items.length,3);
    const secondRound=(await createRound("Vòng khác",pkg.version)).id;
    const otherGroup={...allocation,id:randomUUID(),roundId:secondRound};await createGroqChatbot(admin,otherGroup);
    await assert.rejects(()=>readConversation(member,ref,undefined,otherGroup.id),/Không tìm thấy/);assert.equal((await chatHistory(member,undefined,otherGroup.id)).items.length,0);
    checks.push("round isolation and fresh-run budgets do not overwrite saved conversations");
    await controlChatGroup(admin,allocation.id,"retire");assert.equal((await readConversation(member,ref,undefined,allocation.id)).readOnly,true);
    const backup=await sqlTransaction(()=>exportSqlSnapshot(),true),planned=planSnapshot(backup);
    const archivedRows=planned.tables.runtime_history.filter(row=>row[0]==="chat-group-session");assert.equal(archivedRows.length,3);assert.ok(archivedRows.every(row=>row[2]===roundId&&row[7]===null));
    checks.push("retired chatbot history remains accessible; backup preserves permanent round/run metadata");
    if(process.argv.includes("--keep")) {
      const browserGroup={...allocation,id:randomUUID()};await createGroqChatbot(admin,browserGroup);
      await mkdir(".local",{recursive:true});
      await writeFile(".local/chat-history-browser.env",`ARENA_NAMESPACE=${ns}\nARENA_DATABASE_MODE=postgres\nGPU_WORKSPACE_ENCRYPTION_KEY=${process.env.GPU_WORKSPACE_ENCRYPTION_KEY}\nGROQ_RUNNER_ENABLED=false\n`);
      await writeFile(".local/chat-history-browser.json",JSON.stringify({namespace:ns,password,admin:a.username,member:u.username,teammate:v.username,outsider:x.username,groupId:browserGroup.id,roundId,oldGroupId:allocation.id,firstRef:ref}));keep=true;
    }
    const proof={result:"PASS",namespace:ns,checks,realSupabase:true,realRedis:true,mockedCompletions:calls,realProviderCalls:0,keptForBrowser:keep};
    await mkdir(".local",{recursive:true});await writeFile(".local/chat-history-qa-result.json",JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
  } finally {
    globalThis.fetch=original;
    if(!keep) {
      assert.ok(namespace()===ns&&ns.startsWith("arena:qa:chat-history:"));
      const tables=["team_members","team_invites","admins","users","teams","packages","rounds","runs","registrations","announcements","submissions","submission_quotas","requests","gpu_templates","gpu_credentials","api_credentials","runtime_history","audit_events","legacy_archive","migration_runs","state"];
      await sqlTransaction(async client=>{for(const t of tables)await client.query(`delete from arena.${t} where ns=$1`,[ns]);},true);
      let cursor="0";const keys:string[]=[];do{const[next,found]=await db().scan(cursor,{match:ns+":*",count:100});keys.push(...found);cursor=String(next);}while(cursor!=="0");
      for(const k of keys)assert.ok(k.startsWith(ns+":"));for(let i=0;i<keys.length;i+=100)await db().del(...keys.slice(i,i+100));
    }
    await closeSqlPools();
  }
}
main().catch(e=>{console.error(e instanceof Error?e.stack:"Chat history QA failed");process.exitCode=1;});
