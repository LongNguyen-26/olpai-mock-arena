import { namespace,query,sqlNow } from "./sql";
import { syncRuntimeHistory } from "./runtime-authority";
import { readTeams,userFromRow,submissionFromRow } from "./entity-repository";
import { exportRedisSnapshot,rawRedis,checksum,canonical,importColumns,type DatabaseSnapshot,type SnapshotRecord } from "./database-snapshot";
import { runpodAvailable } from "./runtime-mode";

export function businessKey(suffix:string) {
  return /^(admin|admins|teams|rounds|packages|contest|package|admin:deletions)$/.test(suffix)||
    /^(user|username|code|invites|package|round|runs|registrations|announcements|submissions|quota|request|quota-grant|round-control):/.test(suffix)||
    suffix==="gpu:templates"||suffix.startsWith("gpu:templates:")||suffix.startsWith("gpu:credential:")||suffix.startsWith("api:credential:");
}
/** Produce a Redis-compatible business snapshot from the current SQL authority.
 * Runtime records and files are copied from Redis, never reset to an old backup. */
export async function exportSqlSnapshot():Promise<DatabaseSnapshot> {
  const ns=namespace(),prefix=ns+":";
  if(runpodAvailable()) {
    const maintenance=(await query("select maintenance from arena.state where ns=$1",[ns]))[0]?.maintenance;
    if(!maintenance) await syncRuntimeHistory(10000);
    else if(await rawRedis().hlen(ns+":sql:runtime:pending"))throw new Error("Replay Runpod pending history before freezing for backup");
  }
  const base=runpodAvailable()?await exportRedisSnapshot(ns):{records:[] as SnapshotRecord[],freezeId:null};
  const groqIds=(await query("select id from arena.runtime_history where ns=$1 and kind='chat-group' and payload->>'provider'='groq'",[ns])).map(r=>String(r.id));
  const records=base.records.filter(r=>{
    const suffix=r.key.slice(prefix.length);
    if(businessKey(suffix))return false;
    if(groqIds.some(id=>suffix===`gpu:chat-group:${id}`||suffix.startsWith(`gpu:chat-group:${id}:`)))return false;
    if(suffix.startsWith("gpu:job:")) {const v=typeof r.value==="string"?JSON.parse(r.value):r.value;if(v?.groupId&&groqIds.includes(v.groupId))return false;}
    return true;
  });
  const string=(suffix:string,value:unknown,expiresAt:number|null=null)=>records.push({key:prefix+suffix,type:"string",value:typeof value==="string"?value:JSON.stringify(value),expiresAt});
  const hash=(suffix:string,values:Record<string,unknown>)=>{if(Object.keys(values).length)records.push({key:prefix+suffix,type:"hash",value:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,typeof v==="string"?v:JSON.stringify(v)])),expiresAt:null});};
  const set=(suffix:string,values:string[])=>{if(values.length)records.push({key:prefix+suffix,type:"set",value:values,expiresAt:null});};
  const users=(await query("select * from arena.users where ns=$1 and deleted_at is null",[ns])).map(userFromRow);
  for(const u of users) {string(`user:${u.id}`,u);string(`username:${u.username.toLowerCase()}`,u.id);}
  const admins=await query("select user_id,is_primary from arena.admins where ns=$1",[ns]);
  const primary=admins.find(a=>a.is_primary);if(primary)string("admin",primary.user_id);
  set("admins",admins.filter(a=>!a.is_primary).map(a=>String(a.user_id)));
  const teams=await readTeams();hash("teams",teams);for(const t of Object.values(teams))string(`code:${t.inviteCode}`,t.id);
  const invites=await query("select user_id,team_id from arena.team_invites where ns=$1",[ns]);
  for(const uid of new Set(invites.map(r=>r.user_id)))set(`invites:${uid}`,invites.filter(r=>r.user_id===uid).map(r=>String(r.team_id)));
  const packages=await query("select * from arena.packages where ns=$1",[ns]),catalog:Record<string,unknown>={};
  for(const p of packages) {string(p.id==="__legacy__"?"package":`package:${p.id}`,p.configuration);if(p.listed)catalog[p.id]=p.title;}
  hash("packages",catalog);
  const rounds=await query("select * from arena.rounds where ns=$1",[ns]),z:unknown[]=[];
  for(const r of rounds) {string(r.id==="__legacy__"?"contest":`round:${r.id}`,r.configuration);if(r.catalog_score!==null)z.push(r.id,Number(r.catalog_score));}
  if(z.length)records.push({key:prefix+"rounds",type:"zset",value:z,expiresAt:null});
  for(const r of await query("select * from arena.runs where ns=$1",[ns]))string(`runs:${r.id}`,r.configuration);
  const registrations=await query("select * from arena.registrations where ns=$1",[ns]);
  for(const rid of new Set(registrations.map(r=>r.round_id)))hash(`registrations:${rid}`,Object.fromEntries(registrations.filter(r=>r.round_id===rid).map(r=>[r.user_id,{userId:r.user_id,status:r.status,registeredAt:Number(r.registered_at)}])));
  const announcements=await query("select * from arena.announcements where ns=$1 order by created_at desc,id",[ns]);
  for(const run of new Set(announcements.map(r=>r.run_id)))records.push({key:prefix+`announcements:${run}`,type:"list",value:announcements.filter(r=>r.run_id===run).map(r=>JSON.stringify({id:r.id,text:r.text,createdAt:Number(r.created_at)})),expiresAt:null});
  const submissions=(await query("select * from arena.submissions where ns=$1",[ns])).map(submissionFromRow);
  for(const run of new Set(submissions.map(s=>s.runId)))hash(`submissions:${run}`,Object.fromEntries(submissions.filter(s=>s.runId===run).map(s=>[s.id,s])));
  for(const q of await query("select * from arena.submission_quotas where ns=$1",[ns]))string(`quota:${q.run_id}:${q.actor_id}:${q.task}:${q.split}`,String(q.used));
  const now=await sqlNow();
  // Conversation retention is permanent even when a legacy Redis cache still
  // has a TTL. Preserve newer live messages and merge durable routing metadata.
  for(const r of records) {
    const suffix=r.key.slice(prefix.length);
    if(suffix.startsWith("gpu:chat:")||(suffix.startsWith("gpu:chat-group:")&&suffix.split(":").length>3))r.expiresAt=null;
  }
  const present=new Set(records.map(r=>r.key));
  const locations:Record<string,string>={workspace:"gpu:workspace:","chat-group":"gpu:chat-group:","chat-group-session":"gpu:chat-group:","chat-session":"gpu:chat:","chat-job":"gpu:job:"};
  for(const r of await query("select kind,id,payload,expires_at from arena.runtime_history where ns=$1 and (expires_at is null or expires_at>$2)",[ns,now])) {
    const location=locations[r.kind];if(location&&!present.has(prefix+location+r.id))string(location+r.id,r.payload,r.expires_at===null?null:Number(r.expires_at));
    else if(r.kind==="chat-session"||r.kind==="chat-group-session") {
      const cached=records.find(record=>record.key===prefix+location+r.id);
      if(cached) {
        cached.expiresAt=null;
        const value=typeof cached.value==="string"?JSON.parse(cached.value):cached.value;
        if(!value.conversation&&r.payload.conversation)cached.value=JSON.stringify({...value,conversation:r.payload.conversation});
      }
    }
  }
  for(const r of await query("select * from arena.requests where ns=$1 and (expires_at is null or expires_at>$2)",[ns,now])) {
    const suffix=r.scope==="submission"?"request":r.scope==="round-control"?"round-control":r.scope==="quota-grant"?"quota-grant":null;
    if(suffix)string(`${suffix}:${r.id}`,r.scope==="submission"?r.result:r.fingerprint,r.expires_at===null?null:Number(r.expires_at));
  }
  const templates=await query("select * from arena.gpu_templates where ns=$1",[ns]);
  for(const store of new Set(templates.map(r=>r.store)))hash(store==="shared"?"gpu:templates:shared":store==="legacy"?"gpu:templates":`gpu:templates:${String(store).slice(6)}`,Object.fromEntries(templates.filter(r=>r.store===store).map(r=>[r.id,r.configuration])));
  const state=(await query("select * from arena.state where ns=$1",[ns]))[0];
  if(state?.configuration.templatesShared)string("gpu:templates:shared:ready","1");
  string("gpu:templates:version",String(state?.revision??0));
  for(const c of await query("select * from arena.gpu_credentials where ns=$1",[ns]))string(`gpu:credential:${c.owner_id}`,c.ciphertext);
  for(const c of await query("select * from arena.api_credentials where ns=$1",[ns]))string(`api:credential:${c.provider}:${c.owner_id}`,c.configuration);
  const audit=await query("select * from arena.audit_events where ns=$1 order by created_at",[ns]),deletions:Record<string,unknown>={};
  for(const a of audit)if(a.payload?.kind&&a.payload?.id)deletions[`${a.payload.kind}:${a.payload.id}`]=a.payload;
  hash("admin:deletions",deletions);
  const sqlRuntime:Record<string,unknown[][]>={};
  for(const table of ["sessions","rate_counters","runtime_leases","runtime_signals","chat_lanes","submission_files"]) {
    const columns=importColumns[table];
    sqlRuntime[table]=(await query(`select ${columns.join(",")} from arena.${table} where ns=$1`,[ns])).map(row=>columns.map(column=>Buffer.isBuffer(row[column])?"\\x"+row[column].toString("hex"):row[column]));
  }
  const stateFreeze=(await query("select configuration->>'runtimeFreezeId' as id from arena.state where ns=$1",[ns]))[0]?.id;
  const payload={version:1 as const,sourceNamespace:ns,exportedAt:now,freezeId:stateFreeze??base.freezeId,records:records.sort((a,b)=>a.key.localeCompare(b.key,"en")),sqlRuntime};
  return {...payload,checksum:checksum(payload)};
}
function hashEntries(value:unknown):[string,unknown][] {
  if(Array.isArray(value)) {const out:[string,unknown][]=[];for(let i=0;i<value.length;i+=2)out.push([String(value[i]),value[i+1]]);return out;}
  return Object.entries(value as Record<string,unknown>);
}
function normalizedRecord(r:SnapshotRecord,prefix:string) {
  const value=r.type==="hash"?Object.fromEntries(hashEntries(r.value)):r.type==="set"?[...(r.value as string[])].sort():r.type==="zset"?Object.entries(Object.fromEntries(Array.from({length:(r.value as unknown[]).length/2},(_,i)=>[String((r.value as unknown[])[2*i]),Number((r.value as unknown[])[2*i+1])]))).sort():r.value;
  return {key:r.key.slice(prefix.length),type:r.type,value};
}
export async function restoreBusinessToRedis(snapshot:DatabaseSnapshot,target:string,production=false) {
  const qa=/^arena:qa:[a-zA-Z0-9:_-]+$/.test(target);
  if(!qa&&snapshot.sqlRuntime)throw new Error("SQL runtime snapshots require SQL restoration; legacy Redis business restore cannot roll back Groq/session/file state");
  if(!qa&&(!production||target!==snapshot.sourceNamespace||!snapshot.freezeId))throw new Error("Restore requires a frozen production snapshot and explicit production approval");
  const redis=rawRedis(),prefix=target+":";
  if(!qa) {
    const raw=await redis.get(prefix+"database:write-freeze");const freeze=typeof raw==="string"?JSON.parse(raw):raw;
    if((freeze as {id?:string})?.id!==snapshot.freezeId)throw new Error("Restore write freeze changed");
    const ids=await redis.smembers(prefix+"gpu:workspaces");
    if(ids.length) {
      const records=await redis.mget<string[]>(...ids.map(id=>prefix+`gpu:workspace:${id}`));
      if(records.some(v=>v&&!["terminated","failed"].includes(JSON.parse(v).status)))throw new Error("Do not restore while a GPU workspace is active");
    }
  }
  let cursor="0";const old:string[]=[];
  do{const [next,keys]=await redis.scan(cursor,{match:prefix+"*",count:100});old.push(...keys.filter(k=>k.startsWith(prefix)&&businessKey(k.slice(prefix.length))));cursor=String(next);}while(cursor!=="0");
  for(const k of old)if(!k.startsWith(prefix)||!businessKey(k.slice(prefix.length)))throw new Error("Invalid restore target key");
  for(let i=0;i<old.length;i+=100)await redis.del(...old.slice(i,i+100));
  const sourcePrefix=snapshot.sourceNamespace+":";
  const records=snapshot.records.filter(r=>r.key.startsWith(sourcePrefix)&&businessKey(r.key.slice(sourcePrefix.length))&&(r.expiresAt===null||r.expiresAt>Date.now()));
  for(let i=0;i<records.length;i+=100) {
    const pipeline=redis.pipeline();
    for(const r of records.slice(i,i+100)) {
      const k=prefix+r.key.slice(sourcePrefix.length);
      if(r.type==="string")pipeline.set(k,r.value,r.expiresAt===null?{}:{px:Math.max(1,r.expiresAt-Date.now())});
      else if(r.type==="hash") {const fields=Object.fromEntries(hashEntries(r.value));if(Object.keys(fields).length)pipeline.hset(k,fields);}
      else if(r.type==="set") {const members=r.value as string[];if(members.length)pipeline.sadd(k,...members as [string,...string[]]);}
      else if(r.type==="list") {const values=r.value as unknown[];if(values.length)pipeline.rpush(k,...values as [unknown,...unknown[]]);}
      else if(r.type==="zset") {
        const values=r.value as unknown[];
        for(let j=0;j<values.length;j+=2)pipeline.zadd(k,{member:String(values[j]),score:Number(values[j+1])});
      }
    }
    await pipeline.exec();
  }
  const restored=await exportRedisSnapshot(target);
  const expected=records.map(r=>normalizedRecord(r,sourcePrefix)).map(canonical).sort();
  const actual=restored.records.filter(r=>businessKey(r.key.slice(prefix.length))).map(r=>normalizedRecord(r,prefix)).map(canonical).sort();
  if(checksum(expected)!==checksum(actual))throw new Error("Redis restore verification failed; keep writes frozen");
  return {restored:true,targetNamespace:target,businessKeys:records.length,verified:true,runtimeReset:false};
}
