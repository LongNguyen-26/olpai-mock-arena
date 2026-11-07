/** Requested legacy placement: existing rounds => mock, Regional => topic.
 * Dry-run by default. --apply updates only unclassified rounds through admin API.
 * Credentials stay in the ignored local access file and an ephemeral session.
 */
import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import { arenaBaseUrl } from "./arena-url";
async function main() {
  const base=arenaBaseUrl(),apply=process.argv.includes("--apply");
  const password=(await readFile("ACCESS.local.md","utf8")).match(/Mật khẩu ban đầu: (.+)/)?.[1]?.trim();
  assert.ok(password,"Local admin access unavailable");
  const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({username:"arena_admin",password})});
  assert.equal(login.status,200,"Admin login");
  const cookie=login.headers.getSetCookie().find(c=>c.startsWith("arena-session="))?.split(";")[0];assert.ok(cookie);
  const headers={Cookie:cookie,Origin:base,"Content-Type":"application/json"};
  try {
    const r=await fetch(base+"/api/arena",{headers});assert.equal(r.status,200);const data=await r.json();assert.equal(data.user.admin,true);
    const plan=data.rounds.filter((r:{classificationConfigured?:boolean})=>!r.classificationConfigured).map((r:{id:string;runId:string;revision:number;title:string;category?:string;subcategory?:string})=>({id:r.id,runId:r.runId,revision:r.revision,title:r.title,before:{category:r.category,subcategory:r.subcategory},category:/\bregional\b/i.test(r.title)?"topic":"mock",subcategory:"general"}));
    if(apply)await writeFile(".local/round-classification-before.json",JSON.stringify({base,plan},null,2));
    for(const round of plan)if(apply){const result=await fetch(base+"/api/admin/round/manage?round="+encodeURIComponent(round.id),{method:"POST",headers,body:JSON.stringify({action:"classify",runId:round.runId,revision:round.revision,category:round.category,subcategory:round.subcategory})});assert.equal(result.status,200,`Classification failed for ${round.title}; reload to inspect concurrent changes`);}
    if(apply){const after=await (await fetch(base+"/api/arena",{headers})).json();for(const round of plan){const found=after.rounds.find((r:{id:string})=>r.id===round.id);assert.equal(found?.category,round.category);assert.equal(found?.runId,round.runId);assert.equal(found?.title,round.title);}}
    const result={result:"PASS",mode:apply?"applied":"dry-run",base,count:plan.length,rounds:plan.map(({id,title,category,subcategory}: {id:string;title:string;category:string;subcategory:string})=>({id,title,category,subcategory}))};
    if(apply)await writeFile(".local/round-classification-result.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await fetch(base+"/api/auth/logout",{method:"POST",headers,body:"{}"});}
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Classification failed");process.exitCode=1;});
