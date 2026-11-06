/** Real SQL in a fresh QA namespace; Supabase Auth is mocked, no mail or OAuth account is used.
 * npx tsx --env-file=.env --env-file=.local/supabase-runtime.env scripts/qa-public-auth.ts [--keep]
 * --keep leaves the local servers/fixture for browser QA; stop with Ctrl+C to clean up.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID,createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { once } from "node:events";
import { hashPassword } from "../src/lib/auth";
import { createSqlUser,saveSqlPackage,readUser } from "../src/lib/entity-repository";
import { createRound,control,registerRound,getContest } from "../src/lib/rounds";
import { sqlTeamAction } from "../src/lib/sql-teams";
import { commitSqlSubmission } from "../src/lib/sql-rounds";
import { closeSqlPools,namespace,query,sqlTransaction } from "../src/lib/sql";
import { resolveIdentity } from "../src/lib/auth-identities";
import type { User as ProviderUser } from "@supabase/supabase-js";

async function main() {
  process.env.ARENA_NAMESPACE=`arena:qa:public-auth:${randomUUID()}`;
  process.env.ARENA_DATABASE_MODE="postgres"; process.env.ARENA_RUNPOD_MODE="disabled";
  const ns=namespace(),base="http://localhost:3113",checks:string[]=[];
  const legacyPassword="QA-only-password-12345",legacy={id:randomUUID(),username:"legacy@example.test",name:"QA legacy",password:await hashPassword(legacyPassword),teamId:null,createdAt:Date.now()};
  const identity=(email:string,id=randomUUID()):ProviderUser=>({id,aud:"authenticated",role:"authenticated",email,email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),app_metadata:{provider:"google",providers:["google"]},user_metadata:{full_name:"QA verified user",admin:true},identities:[]});
  const newIdentity=identity("new@example.test"), collision=identity(legacy.username), recovery=identity("recovery@example.test");
  const identities:Record<string,ProviderUser>={new:newIdentity,collision,recovery};
  const session=(user:ProviderUser)=>({access_token:`qa-${user.id}`,refresh_token:"qa-refresh-token",token_type:"bearer",expires_in:3600,user});
  const challenges=new Map<string,string>();
  const provider=createServer(async(req,res)=>{
    try {
      const chunks:Buffer[]=[]; for await(const c of req) chunks.push(Buffer.from(c));
      const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
      const url=new URL(req.url!,"http://localhost");
      let status=200,result:unknown={};
      if(url.pathname.endsWith("/signup")) { challenges.set("signup",body.code_challenge); result={user:newIdentity,session:null}; }
      else if(url.pathname.endsWith("/recover")) { challenges.set("recovery",body.code_challenge); result={}; }
      else if(url.pathname.endsWith("/resend")) {challenges.set("signup",body.code_challenge);result={};}
      else if(url.pathname.endsWith("/token")) {
        if(url.searchParams.get("grant_type")==="pkce") {
          const challenge=challenges.get(body.auth_code);
          const valid=challenge&&challenge===createHash("sha256").update(body.code_verifier??"").digest("base64url");
          if(!valid){status=400;result={code:"bad_code_verifier",message:"QA verifier mismatch"};}
          else result=session(identities[body.auth_code]??newIdentity);
        } else if(body.email==="unconfirmed@example.test") {status=400;result={code:"email_not_confirmed",message:"Unconfirmed"};}
        else if(body.password!==legacyPassword) {status=400;result={code:"invalid_credentials",message:"Invalid"};}
        else result=session(body.email===recovery.email?recovery:newIdentity);
      } else if(url.pathname.endsWith("/user")) {
        const token=req.headers.authorization?.replace("Bearer ","");
        const user=Object.values(identities).find(u=>token===`qa-${u.id}`);
        if(!user){status=401;result={code:"invalid_credentials",message:"Invalid"};}else result=user;
      } else {status=404;result={message:"Unexpected QA provider endpoint"};}
      res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(result));
    } catch {res.writeHead(500);res.end("{}");}
  });
  provider.listen(3114,"127.0.0.1");await once(provider,"listening");
  const app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--port","3113"],{windowsHide:true,env:{...process.env,ARENA_AUTH_MODE:"supabase",ARENA_GOOGLE_AUTH_ENABLED:"true",ARENA_AUTH_ORIGIN:base,SUPABASE_URL:"http://127.0.0.1:3114",SUPABASE_PUBLISHABLE_KEY:"qa-publishable",GROQ_RUNNER_ENABLED:"false",RENDER:"false"},stdio:"ignore"});
  const jar=new Map<string,string>();
  async function request(path:string,value?:unknown,cookies=jar) {
    const res=await fetch(base+path,{method:value===undefined?"GET":"POST",redirect:"manual",headers:{Origin:base,"Content-Type":"application/json",Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join("; ")},...(value===undefined?{}:{body:JSON.stringify(value)})});
    for(const cookie of res.headers.getSetCookie()) {const first=cookie.split(";")[0],i=first.indexOf("=");if(/max-age=0/i.test(cookie)||first.slice(i+1)==="")cookies.delete(first.slice(0,i));else cookies.set(first.slice(0,i),first.slice(i+1));}
    return res;
  }
  try {
    await query("insert into arena.state(ns,imported_at) values($1,$2)",[ns,Date.now()]);
    await createSqlUser(legacy); await sqlTeamAction(legacy.id,"create",{name:"QA Arena Team"});
    const member=(await readUser(legacy.id))!;
    const pkg={version:`qa-auth-${randomUUID()}`,title:"QA Public Auth",statement:"# QA",tasks:[{id:"1" as const,title:"QA tác vụ công khai",content:"# Đề kiểm tra công khai\nNội dung đề được xem không cần đăng nhập."}],assets:[{key:"qa/secret-dataset.zip",name:"dataset.zip",bytes:123,sha256:"qa",phase:"public" as const,description:"QA",driveUrl:"https://drive.google.com/file/d/QA/view"}],judges:{"1":{public:"qa",private:"qa"}},importedAt:Date.now()};
    await saveSqlPackage({...pkg,judges:{...pkg.judges,"2":{public:"qa",private:"qa"}}});
    const {id:round}=await createRound("Vòng luyện kiểm tra truy cập",pkg.version),{id:hidden}=await createRound("QA hidden",pkg.version),{id:waiting}=await createRound("QA waiting",pkg.version);
    await control("visibility",{hidden:true},hidden);
    await registerRound({...member,admin:false},round);
    await control("practice-open",{runId:(await getContest(round)).id,revision:0,requestId:randomUUID(),endAt:null,publicVisible:true,privateVisible:true,chatbotEnabled:false,chatbotUntil:null,notebookEnabled:false},round);
    const c=await getContest(round);
    for(const split of ["public","private"] as const)await commitSqlSubmission({id:randomUUID(),runId:c.id,teamId:member.teamId!,userId:member.id,task:"1",split,filename:"private-filename.csv",createdAt:Date.now(),score:split==="public"?80:95,secondary:0,bytes:10,sha256:"qa",path:"qa/private.csv",note:"secret-note",status:"accepted",adminTest:false},round,randomUUID());
    for(let i=0;i<80;i++){try{if((await fetch(base+"/api/health")).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
    assert.equal((await request("/")).status,200);checks.push("guest homepage returns 200 without a login redirect");
    const snapshot=await (await request(`/api/arena?round=${round}`)).json();
    assert.equal(snapshot.user,null);assert.equal(snapshot.entered,false);assert.equal(snapshot.canReadStatement,true);
    assert.equal(snapshot.leaderboard.public[0].total,80);assert.equal(snapshot.leaderboard.private[0].total,95);
    for(const name of ["assets","submissions","invites","teams","registrations","packages"])assert.deepEqual(snapshot[name],[]);
    assert.equal(snapshot.team,null);assert.equal(snapshot.rounds.some((r:{id:string})=>r.id===hidden),false);
    assert.equal(JSON.stringify(snapshot).includes("secret-note"),false);assert.equal(JSON.stringify(snapshot).includes("drive.google.com"),false);
    assert.equal((await request(`/api/arena?round=${hidden}`)).status,404);
    assert.equal((await request(`/api/statement?round=${hidden}`)).status,404);
    assert.equal((await request(`/api/statement?round=${waiting}`)).status,403);
    assert.equal((await request(`/api/statement?round=${round}`)).status,200);
    for(const path of [`/api/download?round=${round}&asset=qa/secret-dataset.zip`,`/api/submission/download?round=${round}&id=${randomUUID()}`,"/api/admin/roster","/api/workspace/state"] )assert.equal((await request(path)).status,401,path);
    for(const path of ["/api/team",`/api/round/register?round=${round}`,`/api/submit?round=${round}`])assert.equal((await request(path,{})).status,401,path);
    checks.push("guest statement/leaderboard, hidden/unreleased rounds and protected API boundaries");
    assert.equal((await request("/api/auth/login",{username:legacy.username,password:legacyPassword})).status,200);
    assert.equal((await (await request(`/api/arena?round=${round}`)).json()).user.id,legacy.id);
    const login=await (await request("/api/auth/google",{link:true,next:`/?round=${round}#statement`})).json();
    challenges.set("collision",new URL(login.url).searchParams.get("code_challenge")!);
    const linked=await request("/auth/callback?code=collision");assert.equal(linked.status,303);
    assert.equal(new URL(linked.headers.get("location")!).hash,"#statement");
    assert.equal((await (await request("/api/me")).json()).user.id,legacy.id);
    assert.equal((await (await request("/api/arena")).json()).user.admin,false);
    checks.push("legacy login and explicit Google linking preserve user/team and ignore metadata roles");
    await request("/api/auth/logout",{});assert.equal(jar.has("arena-session"),false);
    const registered=await request("/api/auth/register",{username:newIdentity.email,name:"QA email",password:legacyPassword,next:`/?round=${round}#data`});
    assert.equal((await registered.json()).confirmationRequired,true);assert.equal(jar.has("arena-session"),false);
    const confirmed=await request("/auth/callback?code=signup");assert.equal(confirmed.status,303);
    assert.equal(new URL(confirmed.headers.get("location")!).hash,"#data");
    assert.equal((await (await request("/api/me")).json()).user.username,newIdentity.email);
    await request("/api/auth/logout",{});
    const unconfirmed=await request("/api/auth/login",{username:"unconfirmed@example.test",password:legacyPassword});assert.equal(unconfirmed.status,400);assert.equal(jar.has("arena-session"),false);
    checks.push("email signup has no session before confirmation; PKCE confirmation restores destination");
    const existing=await resolveIdentity(identity("collision2@example.test"));
    const dangerous=identity(legacy.username);
    await assert.rejects(()=>resolveIdentity(dangerous),/tài khoản Arena hiện có/);
    await assert.rejects(()=>resolveIdentity({...newIdentity,email_confirmed_at:undefined}),/xác minh/);
    await assert.rejects(()=>resolveIdentity(newIdentity,existing.id),/tài khoản khác/);
    const raced=await Promise.all(Array.from({length:4},()=>resolveIdentity(recovery)));assert.equal(new Set(raced.map(u=>u.id)).size,1);
    const resetLogin=await request("/api/auth/login",{username:recovery.email,password:legacyPassword});assert.equal(resetLogin.status,200);
    const oldToken=jar.get("arena-session")!;jar.delete("arena-session");
    const oldJar=new Map([["arena-session",oldToken]]);assert.notEqual((await (await request("/api/me",undefined,oldJar)).json()).user,null);
    assert.equal((await request("/api/auth/forgot",{username:recovery.email})).status,200);
    assert.equal((await request("/auth/callback?code=recovery")).status,303);
    assert.equal((await request("/api/auth/reset",{password:"QA-new-strong-password-6789"})).status,200);
    assert.equal((await (await request("/api/me",undefined,oldJar)).json()).user,null);
    const absentJar=new Map<string,string>();assert.equal((await request("/auth/callback?code=signup",undefined,absentJar)).status,303);assert.equal(absentJar.has("arena-session"),false);
    checks.push("identity collision, unverified identity, concurrency, reset and missing-PKCE defenses");
    await writeFile(".local/public-auth-browser-fixture.json",JSON.stringify({namespace:ns,base,round,hidden,waiting,legacyUsername:legacy.username,legacyPassword},null,2));
    const proof={result:"PASS",checks,realSQL:true,authProvider:"mock",sentEmails:0,paidResources:0};
    await writeFile(".local/public-auth-qa-result.json",JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
    if(process.argv.includes("--keep")){console.log("Local QA ready at "+base);await new Promise<void>(resolve=>process.once("SIGINT",()=>resolve()));}
  } finally {
    app.kill();provider.close();
    assert.equal(namespace(),ns);assert.ok(ns.startsWith("arena:qa:public-auth:"));
    await sqlTransaction(async client=>{for(const table of ["auth_identities","sessions","rate_counters","team_members","team_invites","registrations","submissions","submission_quotas","requests","admins","users","teams","packages","rounds","runs","state"])await client.query(`delete from arena.${table} where ns=$1`,[ns]);},true);
    await closeSqlPools();
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:"QA failed");process.exitCode=1;});
