/** Production smoke: login/read/logout only; never edits/deletes/reorders real rounds. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { arenaBaseUrl } from "./arena-url";
async function main() {
  const base=arenaBaseUrl(),expected=process.argv.find(v=>v.startsWith("--commit="))?.slice(9);
  const request=(path:string,init:RequestInit={})=>fetch(base+path,{...init,redirect:"manual",signal:AbortSignal.timeout(60000)});
  const health=await request("/api/health");assert.equal(health.status,200);
  const state=await health.json();assert.equal(state.database,"postgres");if(expected)assert.equal(state.commit,expected);
  const password=(await readFile("ACCESS.local.md","utf8")).match(/Mật khẩu ban đầu: (.+)/)?.[1]?.trim();assert.ok(password);
  const login=await request("/api/auth/login",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({username:"arena_admin",password})});
  assert.equal(login.status,200);const cookie=login.headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
  try {
    const response=await request("/api/arena",{headers:{Cookie:cookie}});assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.user.admin,true);assert.ok(data.packages.length>0);
    for(const p of data.packages) assert.match(p.title,/^Bộ đề Arena \d+ · (Bản cũ|Bản hiện hành|Chuẩn hóa cũ v\d+)/);
    for(const r of data.rounds) {
      assert.ok(data.packages.some((p:{title:string})=>p.title===r.packageTitle));
      assert.equal(r.taskTitles.length,r.taskCount);assert.ok(r.runId);
      for(const t of r.taskTitles) assert.deepEqual(Object.keys(t).sort(),["id","title"]);
    }
    console.log(JSON.stringify({result:"PASS",base,commit:state.commit,rounds:data.rounds.length,
      packages:data.packages.map((p:{title:string})=>p.title),sourceLabels:true,taskTitles:true,roundMutations:0,providerCalls:0}));
  } finally {
    assert.equal((await request("/api/auth/logout",{method:"POST",headers:{Origin:base,Cookie:cookie}})).status,200);
  }
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Catalogue smoke failed");process.exitCode=1;});
