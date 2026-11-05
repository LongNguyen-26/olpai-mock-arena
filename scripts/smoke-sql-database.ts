/** Login/read/logout only. Does not call Runpod, submit, or change core records. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { arenaBaseUrl } from "./arena-url";

async function main() {
  const base=arenaBaseUrl(),expectedCommit=process.argv.find(v=>v.startsWith("--commit="))?.slice(9);
  const request=(path:string,init:RequestInit={})=>fetch(base+path,{...init,redirect:"manual",signal:AbortSignal.timeout(90000)});
  const health=await request("/api/health");assert.equal(health.status,200);
  const state=await health.json();assert.equal(state.database,"postgres");assert.equal(state.databaseMigration,1);
  if(expectedCommit)assert.equal(state.commit,expectedCommit);
  assert.equal((await request("/api/arena")).status,401);
  const password=(await readFile("ACCESS.local.md","utf8")).match(/Mật khẩu ban đầu: (.+)/)?.[1]?.trim();
  assert.ok(password,"Local admin access unavailable");
  const login=await request("/api/auth/login",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({username:"arena_admin",password})});
  assert.equal(login.status,200,"SQL login with unchanged password hash");
  const session=login.headers.get("set-cookie");assert.ok(session&&/httponly/i.test(session));
  const cookie=session.split(";")[0];
  try {
    const read=async(path:string)=>{const r=await request(path,{headers:{Cookie:cookie}});assert.equal(r.status,200,path.split("?")[0]);return r.json();};
    const catalog=await read("/api/arena");assert.equal(catalog.user.admin,true);
    let visibleSubmissions=0;
    for(const r of catalog.rounds) {
      const suffix="?round="+encodeURIComponent(r.id),snapshot=await read("/api/arena"+suffix);
      assert.equal(snapshot.contest.roundId??snapshot.contest.id,r.id);
      assert.ok(Array.isArray(snapshot.submissions));visibleSubmissions+=snapshot.submissions.length;
      assert.ok((await read("/api/statement"+suffix)).tasks.length>0);
    }
    const workspaces=await read("/api/workspace/state");assert.ok(Array.isArray(workspaces.workspaces));
    for(const w of workspaces.workspaces)for(const field of ["secret","jupyterSecret","ownerId"])assert.equal(field in w,false);
    await read("/api/admin/roster");
    console.log(JSON.stringify({result:"PASS",base,database:state.database,commit:state.commit,rounds:catalog.rounds.length,visibleSubmissions,workspaces:workspaces.workspaces.length,providerCalls:0}));
  } finally {
    const logout=await request("/api/auth/logout",{method:"POST",headers:{Origin:base,Cookie:cookie}});assert.equal(logout.status,200);
  }
}
main().catch(e=>{console.error(e instanceof Error?e.message:"SQL HTTP smoke failed");process.exitCode=1;});
