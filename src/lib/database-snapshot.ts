import { Redis } from "@upstash/redis";
import { createHash,createCipheriv,createDecipheriv,randomBytes,randomUUID } from "node:crypto";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { dirname,resolve,relative,isAbsolute } from "node:path";
import type { PoolClient } from "pg";
import { namespace,sqlTransaction,sqlNow,query } from "./sql";
import type { Contest,ContestPackage,Submission,Team,User } from "./types";

export interface SnapshotRecord { key:string; type:string; value:unknown; expiresAt:number|null }
export interface DatabaseSnapshot { version:1; sourceNamespace:string; exportedAt:number; freezeId:string|null; records:SnapshotRecord[]; checksum:string }
export function canonical(value:unknown):string {
  if(Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  if(value&&typeof value==="object") return "{"+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,"en")).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
  return JSON.stringify(value)??"null";
}
export const checksum=(value:unknown)=>createHash("sha256").update(canonical(value)).digest("hex");
const parse=(v:unknown):any=>{if(typeof v!=="string") return v;try{return JSON.parse(v);}catch{return v;}};
export function rawRedis() {
  const url=process.env.UPSTASH_REDIS_REST_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token) throw new Error("Missing Redis export credentials");
  return new Redis({url,token,automaticDeserialization:false});
}
export async function exportRedisSnapshot(sourceNamespace:string):Promise<DatabaseSnapshot> {
  if(!/^arena:[a-zA-Z0-9:_-]+$/.test(sourceNamespace)) throw new Error("Invalid source namespace");
  const redis=rawRedis(),prefix=sourceNamespace+":";
  let cursor="0";const found=new Set<string>();
  do { const [next,keys]=await redis.scan(cursor,{match:prefix+"*",count:100});keys.forEach(k=>found.add(k));cursor=String(next); } while(cursor!=="0");
  const keys=[...found].sort(),records:SnapshotRecord[]=[];
  const freeze=parse(await redis.get(prefix+"database:write-freeze"));
  const t=await redis.time(),exportedAt=Number(t[0])*1000+Math.floor(Number(t[1])/1000);
  for(let offset=0;offset<keys.length;offset+=100) {
    const batch=keys.slice(offset,offset+100),meta=redis.pipeline();
    batch.forEach(k=>{meta.type(k);meta.pttl(k);}); const types=await meta.exec();
    const pipeline=redis.pipeline(),live=batch.map((k,i)=>({k,type:String(types[i*2]),ttl:Number(types[i*2+1])})).filter(r=>r.type!=="none"&&r.ttl!==-2);
    for(const r of live) {
      if(r.type==="string") pipeline.get(r.k);
      else if(r.type==="hash") pipeline.hgetall(r.k);
      else if(r.type==="set") pipeline.smembers(r.k);
      else if(r.type==="list") pipeline.lrange(r.k,0,-1);
      else if(r.type==="zset") pipeline.zrange(r.k,0,-1,{withScores:true});
      else throw new Error("Unsupported Redis type in export: "+r.type);
    }
    const values=live.length?await pipeline.exec():[];
    const now=Date.now();
    for(const [i,r] of live.entries()) records.push({key:r.k,type:r.type,value:values[i],expiresAt:r.ttl<0?null:now+r.ttl});
  }
  const finalFreeze=parse(await redis.get(prefix+"database:write-freeze"));
  const freezeId=freeze?.id&&freeze.id===finalFreeze?.id?String(freeze.id):null;
  const payload={version:1 as const,sourceNamespace,exportedAt,freezeId,records};
  return {...payload,checksum:checksum(payload)};
}
function privateBackupPath(path:string) {
  const base=resolve(".local/database-backups"),target=resolve(path),rel=relative(base,target);
  if(rel.startsWith("..")||isAbsolute(rel)||!rel) throw new Error("Backups must be inside .local/database-backups/");
  return target;
}
export async function saveEncryptedSnapshot(snapshot:DatabaseSnapshot,path:string) {
  const target=privateBackupPath(path),key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(snapshot),"utf8"),cipher.final()]);
  await mkdir(dirname(target),{recursive:true});
  await writeFile(target+".key",key.toString("base64"),{flag:"wx",mode:0o600});
  await writeFile(target,JSON.stringify({version:1,algorithm:"aes-256-gcm",iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:ciphertext.toString("base64")}),{flag:"wx",mode:0o600});
  return target;
}
export async function loadEncryptedSnapshot(path:string):Promise<DatabaseSnapshot> {
  const target=privateBackupPath(path),envelope=JSON.parse(await readFile(target,"utf8")),key=Buffer.from((await readFile(target+".key","utf8")).trim(),"base64");
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(envelope.iv,"base64"));decipher.setAuthTag(Buffer.from(envelope.tag,"base64"));
  const snapshot=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,"base64")),decipher.final()]).toString("utf8"));
  const {checksum:expected,...payload}=snapshot;
  if(snapshot.version!==1||checksum(payload)!==expected) throw new Error("Backup checksum mismatch");
  return snapshot;
}
export const importColumns:Record<string,string[]>={
  users:["id","username","name","password_hash","team_id","created_at","deleted_at"],
  admins:["user_id","is_primary"],teams:["id","name","captain_id","invite_code","created_at","deleted_at"],
  team_members:["team_id","user_id","position"],team_invites:["user_id","team_id"],
  packages:["id","title","statement","imported_at","listed","configuration"],
  rounds:["id","run_id","package_id","title","revision","chat_epoch","catalog_score","created_at","configuration"],
  runs:["id","round_id","configuration"],registrations:["round_id","user_id","status","registered_at"],
  announcements:["run_id","id","text","created_at"],
  submissions:["id","run_id","actor_id","user_id","task","split","filename","created_at","score","secondary","metric","bytes","sha256","path","file_storage","note","status","error","admin_test"],
  submission_quotas:["run_id","actor_id","task","split","used"],requests:["scope","id","fingerprint","result","expires_at"],
  gpu_templates:["store","id","name","revision","configuration"],gpu_credentials:["owner_id","ciphertext"],api_credentials:["owner_id","provider","configuration"],
  runtime_history:["kind","id","round_id","run_id","owner_id","status","payload","expires_at","observed_at"],
  audit_events:["id","kind","payload","created_at"],legacy_archive:["source_key","redis_type","payload","expires_at"],
};
type Plan={tables:Record<string,unknown[][]>;issues:string[];configuration:{templatesShared:boolean};counts:Record<string,number>};
export function planSnapshot(snapshot:DatabaseSnapshot):Plan {
  const prefix=snapshot.sourceNamespace+":",source=new Map(snapshot.records.map(r=>[r.key.slice(prefix.length),r]));
  for(const r of snapshot.records) if(!r.key.startsWith(prefix)) throw new Error("Snapshot key outside its source namespace");
  const tables:Record<string,unknown[][]>=Object.fromEntries(Object.keys(importColumns).map(t=>[t,[]]));
  const add=(t:string,...values:unknown[])=>tables[t].push(values.map(v=>v??null));
  const value=(k:string)=>parse(source.get(k)?.value);
  const hash=(r?:SnapshotRecord):readonly (readonly [string,any])[]=>{
    const raw=r?.value??{};
    if(Array.isArray(raw)) { const pairs:[string,any][]=[];for(let i=0;i<raw.length;i+=2)pairs.push([String(raw[i]),parse(raw[i+1])]);return pairs; }
    return Object.entries(raw as Record<string,unknown>).map(([k,v])=>[k,parse(v)] as const);
  };
  const catalog=Object.fromEntries(hash(source.get("packages")));
  const roundScores=new Map<string,number>();const z=source.get("rounds")?.value as unknown[]??[];
  for(let i=0;i<z.length;i+=2) roundScores.set(String(z[i]),Number(z[i+1]));
  const issues:string[]=[],users=new Map<string,User>(),teams=new Map<string,Team>();
  const primary=value("admin"),admins=new Set<string>([...(primary?[primary]:[]),...((value("admins")??[]) as string[])]);
  for(const [k,r] of source) {
    if(k.startsWith("user:")) { const u=parse(r.value) as User;users.set(u.id,u);add("users",u.id,u.username,u.name,u.password,u.teamId,u.createdAt,null); }
    if(k==="teams") for(const [id,t] of hash(r)) { const team=t as Team;teams.set(id,team);add("teams",id,team.name,team.captainId,team.inviteCode,team.createdAt,null); }
  }
  const memberships=new Set<string>();
  for(const [id,t] of teams) {
    if(!Array.isArray(t.members)||t.members.length>3) {issues.push("Invalid team member list");continue;}
    for(const [position,uid] of t.members.entries()) {
      if(!users.has(uid)||users.get(uid)?.teamId!==id||memberships.has(uid)) issues.push("Inconsistent current team membership");
      memberships.add(uid);add("team_members",id,uid,position);
    }
  }
  for(const u of users.values()) if(u.teamId&&!memberships.has(u.id)) issues.push("User team pointer has no membership");
  for(const id of admins) {if(!users.has(id)) issues.push("Administrator is missing its user record");add("admins",id,id===primary);}
  for(const [k,r] of source) {
    const raw=parse(r.value);
    if(k.startsWith("invites:")) for(const tid of raw??[]) add("team_invites",k.slice(8),tid);
    else if(k==="package"||k.startsWith("package:")) {
      const p=raw as ContestPackage,id=k==="package"?"__legacy__":k.slice(8);
      add("packages",id,p.title??p.version,p.statement,p.importedAt,!!catalog[id],JSON.stringify(p));
    } else if(k==="contest"||k.startsWith("round:")) {
      const c=raw as Contest,id=k==="contest"?"__legacy__":k.slice(6);
      add("rounds",id,c.id,c.packageId??null,c.title,c.revision??0,c.chatEpoch??0,roundScores.get(id)??null,c.createdAt,JSON.stringify(c));
    } else if(k.startsWith("runs:")) {const c=raw as Contest;add("runs",k.slice(5),c.roundId??null,JSON.stringify(c));}
    else if(k.startsWith("registrations:")) for(const [uid,v] of hash(r)) add("registrations",k.slice(14),uid,v.status,v.registeredAt);
    else if(k.startsWith("announcements:")) for(const a of (r.value as unknown[]).map(parse)) add("announcements",k.slice(14),a.id,a.text,a.createdAt);
    else if(k.startsWith("submissions:")) for(const [,v] of hash(r)) {
      const s=v as Submission;add("submissions",s.id,s.runId,s.teamId,s.userId,s.task,s.split,s.filename,s.createdAt,s.score,s.secondary,s.metric??null,s.bytes,s.sha256,s.path,s.fileStorage??null,s.note??"",s.status??null,s.error??null,!!s.adminTest);
    } else if(k.startsWith("quota:")) {
      const parts=k.slice(6).split(":"),run=parts.shift(),split=parts.pop(),task=parts.pop();add("submission_quotas",run,parts.join(":"),task,split,Number(raw));
    } else if(k.startsWith("request:")) add("requests","submission",k.slice(8),k.slice(8),JSON.stringify(raw),r.expiresAt);
    else if(k.startsWith("round-control:")) add("requests","round-control",k.slice(14),String(raw),"true",r.expiresAt);
    else if(k.startsWith("quota-grant:")) add("requests","quota-grant",k.slice(12),String(raw),"true",r.expiresAt);
    else if((k==="gpu:templates"||k.startsWith("gpu:templates:"))&&r.type==="hash") {
      const store=k==="gpu:templates"?"legacy":k==="gpu:templates:shared"?"shared":`owner:${k.slice(14)}`;
      for(const [id,t] of hash(r)) add("gpu_templates",store,id,t.name,t.revision??null,JSON.stringify(t));
    } else if(k.startsWith("gpu:credential:")) add("gpu_credentials",k.slice(15),String(raw));
    else if(k.startsWith("api:credential:groq:")) add("api_credentials",k.slice(20),"groq",JSON.stringify(raw));
    else if(k==="admin:deletions") for(const [id,a] of hash(r)) add("audit_events",id,"legacy-roster-delete",JSON.stringify(a),a.deletedAt??snapshot.exportedAt);
    else {
      let kind:string|undefined,id:string|undefined;
      if(k.startsWith("gpu:workspace:")) {kind="workspace";id=k.slice(14);}
      else if(k.startsWith("gpu:chat-group:")) {kind=k.split(":").length>3?"chat-group-session":"chat-group";id=k.slice(15);}
      else if(k.startsWith("gpu:chat:")) {kind="chat-session";id=k.slice(9);}
      else if(k.startsWith("gpu:job:")) {kind="chat-job";id=k.slice(8);}
      if(kind) add("runtime_history",kind,id,raw.conversation?.roundId??raw.roundId??null,raw.conversation?.runId??raw.runId??null,raw.ownerId??null,raw.status??null,JSON.stringify(raw),r.expiresAt,snapshot.exportedAt);
      else if(r.expiresAt===null&&!/^(user:|username:|teams$|code:|invites:|admins?$|packages$|rounds$|submission-file:|gpu:(active|workspaces$|chat-groups$|drain|templates:shared:ready|templates:version)|sql:|database:)/.test(k)) add("legacy_archive",k,r.type,JSON.stringify(r.value),r.expiresAt);
    }
  }
  return {tables,issues,configuration:{templatesShared:!!value("gpu:templates:shared:ready")},counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length]))};
}
async function bulkInsert(client:PoolClient,table:string,columns:string[],rows:unknown[][]) {
  if(!importColumns[table]) throw new Error("Invalid import table");
  for(let offset=0;offset<rows.length;offset+=100) {
    const batch=rows.slice(offset,offset+100),params:unknown[]=[];
    const tuples=batch.map(row=>"("+[namespace(),...row].map(v=>{params.push(v);return "$"+params.length;}).join(",")+")");
    await client.query(`insert into arena.${table}(ns,${columns.join(",")}) values ${tuples.join(",")}`,params);
  }
}
export async function importSnapshot(snapshot:DatabaseSnapshot,allowProduction=false) {
  const target=namespace(),plan=planSnapshot(snapshot);
  if(plan.issues.length) throw new Error(`Import preflight found ${plan.issues.length} relationship issues. No data imported.`);
  if(!target.startsWith("arena:qa:")&&!target.startsWith("arena:stage:")) {
    if(!allowProduction||target!==snapshot.sourceNamespace||!snapshot.freezeId) throw new Error("Production import needs a verified write freeze and explicit --production");
    const freeze=parse(await rawRedis().get(`${target}:database:write-freeze`));
    if(freeze?.id!==snapshot.freezeId) throw new Error("Source write freeze changed");
  }
  const started=Date.now();
  await sqlTransaction(async client=>{
    for(const table of Object.keys(importColumns)) {
      const count=await client.query(`select count(*)::int as n from arena.${table} where ns=$1`,[target]);
      if(count.rows[0].n) throw new Error("Destination namespace is not empty: "+table);
    }
    await client.query("insert into arena.state(ns,revision,imported_at,source_checksum,configuration) values($1,1,$2,$3,$4) on conflict(ns) do update set revision=arena.state.revision+1,imported_at=excluded.imported_at,source_checksum=excluded.source_checksum,configuration=excluded.configuration",[target,await sqlNow(client),snapshot.checksum,JSON.stringify(plan.configuration)]);
    for(const [table,columns] of Object.entries(importColumns)) await bulkInsert(client,table,columns,plan.tables[table]);
    await client.query("insert into arena.migration_runs(ns,id,status,report,created_at) values($1,$2,'imported',$3,$4)",[target,randomUUID(),JSON.stringify({sourceNamespace:snapshot.sourceNamespace,sourceChecksum:snapshot.checksum,counts:plan.counts,frozen:!!snapshot.freezeId}),await sqlNow(client)]);
  },true,true);
  return {targetNamespace:target,sourceNamespace:snapshot.sourceNamespace,counts:plan.counts,elapsedMs:Date.now()-started};
}
const jsonColumns=new Set(["configuration","payload","result","report"]);
const numericColumns=new Set(["created_at","registered_at","imported_at","catalog_score","revision","chat_epoch","score","secondary","metric","bytes","used","position","expires_at","observed_at"]);
export async function verifySnapshot(snapshot:DatabaseSnapshot) {
  const plan=planSnapshot(snapshot),tables:Record<string,unknown>={},mismatches:string[]=[];
  for(const [table,columns] of Object.entries(importColumns)) {
    const rows=await query(`select ${columns.join(",")} from arena.${table} where ns=$1`,[namespace()]);
    const expected=plan.tables[table].map(row=>row.map((v,i)=>jsonColumns.has(columns[i])&&typeof v==="string"?JSON.parse(v):v));
    const actual=rows.map(r=>columns.map(c=>numericColumns.has(c)&&!(table==="gpu_templates"&&c==="revision")&&r[c]!==null?Number(r[c]):r[c]));
    const digest=(items:unknown[])=>checksum(items.map(canonical).sort());
    const match=rows.length===expected.length&&digest(actual)===digest(expected);
    tables[table]={expected:expected.length,actual:rows.length,match};if(!match)mismatches.push(table);
  }
  return {result:mismatches.length?"FAIL":"PASS",targetNamespace:namespace(),mismatches,tables};
}
