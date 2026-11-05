import { randomUUID } from "node:crypto";
import { memoRead } from "./read-scope";
import type { PoolClient } from "pg";
import { db,key } from "./db";
import { usingPostgres,namespace,sqlTransaction,query,sqlNow,bumpRevision,afterSqlCommit } from "./sql";
import { readTeams,readAdminIds } from "./entity-repository";
import { applyPrivateTransition } from "./domain";
import { putSqlRound } from "./sql-rounds";
import type { Contest } from "./types";

const pendingKey=()=>key("sql:runtime:pending");
const authorityKey=(suffix:string)=>key(`sql:authority:data:${suffix}`);
const runtimeKey=(k:string)=>!!archiveKind(k)||k.startsWith(key("gpu:worker:"));
async function synchronizePolicy(client:PoolClient) {
  const ns=namespace(),now=await sqlNow(client);
  const rounds=(await client.query("select id,configuration from arena.rounds where ns=$1",[ns])).rows;
  let changed=false;
  for(const row of rounds) {
    const next=applyPrivateTransition(row.configuration as Contest,now);
    if(next!==row.configuration) { row.configuration=next; await putSqlRound(client,next); changed=true; }
  }
  if(changed) await bumpRevision(client);
  const state=(await client.query("select revision,imported_at from arena.state where ns=$1",[ns])).rows[0];
  if(!state || (!state.imported_at&&!ns.startsWith("arena:qa:"))) throw new Error("SQL namespace has not been imported and verified");
  const revision=`1:${state.revision}`;
  if(await db().get<string>(key("sql:authority:revision"))===revision) return;
  const users=(await client.query("select id,username,name,team_id,created_at from arena.users where ns=$1 and deleted_at is null",[ns])).rows;
  const teams=await readTeams(),admins=await readAdminIds();
  const primary=(await client.query("select user_id from arena.admins where ns=$1 and is_primary",[ns])).rows[0]?.user_id;
  const registrations=(await client.query("select round_id,user_id,status,registered_at from arena.registrations where ns=$1",[ns])).rows;
  const strings:Record<string,string>={};
  for(const u of users) strings[authorityKey(`user:${u.id}`)]=JSON.stringify({id:u.id,username:u.username,name:u.name,teamId:u.team_id,createdAt:Number(u.created_at)});
  for(const r of rounds) strings[authorityKey(r.id==="__legacy__"?"contest":`round:${r.id}`)]=JSON.stringify(r.configuration);
  if(primary) strings[authorityKey("admin")]=primary;
  const hashes:Record<string,Record<string,string>>={ [authorityKey("teams")]:Object.fromEntries(Object.values(teams).map(t=>[t.id,JSON.stringify(t)])) };
  for(const r of registrations) (hashes[authorityKey(`registrations:${r.round_id}`)]??={})[r.user_id]=JSON.stringify({userId:r.user_id,status:r.status,registeredAt:Number(r.registered_at)});
  // Replace exactly the previous projection's keys. No SCAN/FLUSH and no
  // unrelated application or QA keys can be deleted.
  const manifest=[...Object.keys(strings),...Object.keys(hashes),authorityKey("admins")];
  await db().eval(`local old=redis.call('GET',KEYS[1]);if old then for _,k in ipairs(cjson.decode(old)) do redis.call('DEL',k) end end
    local s=cjson.decode(ARGV[1]);for k,v in pairs(s) do redis.call('SET',k,v) end
    local hashes=cjson.decode(ARGV[2]);for k,h in pairs(hashes) do for f,v in pairs(h) do redis.call('HSET',k,f,v) end end
    for _,id in ipairs(cjson.decode(ARGV[3])) do redis.call('SADD',KEYS[3],id) end
    redis.call('SET',KEYS[1],ARGV[4]);redis.call('SET',KEYS[2],ARGV[5]);return 1`,
    [key("sql:authority:manifest"),key("sql:authority:revision"),authorityKey("admins")],
    [JSON.stringify(strings),JSON.stringify(hashes),JSON.stringify(admins),JSON.stringify(manifest),revision]);
}
function archiveKind(k:string) {
  const suffix=k.slice(key("").length);
  if(suffix.startsWith("gpu:workspace:")) return ["workspace",suffix.slice(14)];
  if(suffix.startsWith("gpu:chat-group:")) return [suffix.split(":").length>3?"chat-group-session":"chat-group",suffix.slice(15)];
  if(suffix.startsWith("gpu:chat:")) return ["chat-session",suffix.slice(9)];
  if(suffix.startsWith("gpu:job:")) return ["chat-job",suffix.slice(8)];
  return null;
}
async function drainHistory(client:PoolClient,limit=20) {
  const pending=await db().hgetall<Record<string,string>>(pendingKey())??{};
  const selected=Object.entries(pending).slice(0,limit);
  const values=new Map<string,unknown>();
  for(const [k] of selected) {
    const raw=await db().get<Record<string,unknown>>(k); values.set(k,raw);
    if(raw&&k.startsWith(key("gpu:worker:"))) {
      for(const id of new Set([raw.jobId,...Object.values(raw.slotJobs as Record<string,string>??{})].filter(Boolean))) {
        const jk=key(`gpu:job:${id}`);values.set(jk,await db().get(jk));
      }
    }
  }
  for(const raw of [...values.values()]) if(raw&&typeof raw==="object"&&"sessionKey" in raw&&typeof raw.sessionKey==="string") {
    values.set(raw.sessionKey,await db().get(raw.sessionKey));
  }
  const now=await sqlNow(client);
  for(const [k,raw] of values) {
    const kind=archiveKind(k); if(!kind||!raw||typeof raw!=="object") continue;
    const r=raw as Record<string,unknown>,ttl=await db().pttl(k);
    if(ttl===-2) continue;
    const expiresAt=ttl<0?null:Math.floor((Date.now()+ttl)/1000)*1000;
    await client.query(`insert into arena.runtime_history(ns,kind,id,round_id,run_id,owner_id,status,payload,expires_at,observed_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(ns,kind,id) do update set
      round_id=excluded.round_id,run_id=excluded.run_id,owner_id=excluded.owner_id,status=excluded.status,
      payload=excluded.payload,expires_at=excluded.expires_at,observed_at=excluded.observed_at
      where arena.runtime_history.payload is distinct from excluded.payload or arena.runtime_history.expires_at is distinct from excluded.expires_at`,
    [namespace(),kind[0],kind[1],r.roundId??null,r.runId??null,r.ownerId??null,r.status??null,JSON.stringify(raw),expiresAt,now]);
  }
  if(selected.length) afterSqlCommit(()=>db().eval(`for i=1,#ARGV,2 do if redis.call('HGET',KEYS[1],ARGV[i])==ARGV[i+1] then redis.call('HDEL',KEYS[1],ARGV[i]) end end;return 1`,[pendingKey()],selected.flat()));
}
export async function runtimeEval<TArgs extends unknown[]=unknown[],T=unknown>(script:string,keys:string[],args:TArgs=[] as unknown as TArgs):Promise<T> {
  if(await db().get(key("database:write-freeze"))) throw new Error("Database writes are temporarily frozen");
  script=`if redis.call('EXISTS',${JSON.stringify(key("database:write-freeze"))})==1 then return redis.error_reply('ARENA_WRITE_FREEZE') end;\n`+script;
  if(!usingPostgres()) return db().eval<TArgs,T>(script,keys,args);
  return sqlTransaction(async client=>{
    await synchronizePolicy(client);
    const candidates=keys.filter(runtimeKey);
    // Mark queued jobs before claim can cancel/remove them from their lanes.
    for(const k of keys.filter(k=>k.startsWith(key("gpu:queue:")))) {
      const queue=await db().get<{lanes?:Record<string,string[]>}>(k);
      for(const id of Object.values(queue?.lanes??{}).flat()) candidates.push(key(`gpu:job:${id}`));
    }
    if(candidates.length) await db().hset(pendingKey(),Object.fromEntries(candidates.map(k=>[k,randomUUID()])));
    // Runtime Lua reads a separate, versioned SQL projection. The original
    // Redis business records stay intact for backup/rollback. No Redis-shaped
    // SQL adapter: only Lua's domain key lookups are redirected here.
    const source=key(""),target=authorityKey("");
    if(!/^[a-zA-Z0-9:_-]+$/.test(source)) throw new Error("Invalid namespace");
    const bridge=`local function arena_redis(command,...) local a={...};local k=a[1]
      if type(k)=='string' and string.sub(k,1,${source.length})==${JSON.stringify(source)} then
        local s=string.sub(k,${source.length+1});if s=='admin' or s=='admins' or s=='teams' or s=='contest' or string.match(s,'^user:') or string.match(s,'^round:') or string.match(s,'^registrations:') then a[1]=${JSON.stringify(target)}..s end
      end;return redis.call(command,unpack(a)) end\n`;
    const result=await db().eval<TArgs,T>(bridge+script.replaceAll("redis.call(","arena_redis("),keys,args);
    await drainHistory(client);
    return result;
  },true);
}
export async function syncRuntimeHistory(limit=20) {
  if(!usingPostgres()) return;
  if(!Number.isInteger(limit)||limit<1||limit>10000)throw new Error("Invalid history replay limit");
  await memoRead(`history-sync:${limit}`,()=>sqlTransaction(async client=>{
    await drainHistory(client,limit);
    const now=await sqlNow(client);
    const state=(await client.query("select configuration from arena.state where ns=$1",[namespace()])).rows[0];
    if(state&&now-Number(state.configuration.lastRetentionCleanupAt??0)>3600000) {
      for(const table of ["runtime_history","requests"]) await client.query(`delete from arena.${table} where ctid in (select ctid from arena.${table} where ns=$1 and expires_at<$2 limit 200)`,[namespace(),now]);
      await client.query("update arena.state set configuration=jsonb_set(configuration,'{lastRetentionCleanupAt}',to_jsonb($2::bigint)) where ns=$1",[namespace(),now]);
    }
  },true));
}
export async function readRuntimeHistory<T>(kind:string,id?:string):Promise<T[]> {
  return memoRead(`history:${kind}:${id??""}`,async()=>{
  await syncRuntimeHistory();
  const rows=await query(`select payload from arena.runtime_history where ns=$1 and kind=$2 and ($3::text is null or id=$3)
    and (expires_at is null or expires_at>floor(extract(epoch from clock_timestamp())*1000)) order by observed_at desc`,[namespace(),kind,id??null]);
  return rows.map(r=>r.payload as T);
  });
}
export async function readChatContext<T>(k:string):Promise<T|null> {
  const cached=await db().get<T>(k);if(cached||!usingPostgres()) return cached;
  const location=archiveKind(k);
  if(!location||!["chat-session","chat-group-session"].includes(location[0])) throw new Error("Invalid chat context key");
  const rows=await query("select payload,expires_at from arena.runtime_history where ns=$1 and kind=$2 and id=$3 and expires_at>floor(extract(epoch from clock_timestamp())*1000)",[namespace(),...location]);
  const row=rows[0];if(!row)return null;
  const remaining=Number(row.expires_at)-Date.now();if(remaining<=0)return null;
  await db().set(k,row.payload,{nx:true,px:remaining});
  return db().get<T>(k);
}
export async function readChatJob<T>(k:string):Promise<T|null> {
  const cached=await db().get<T>(k);if(cached||!usingPostgres()) return cached;
  const location=archiveKind(k);if(location?.[0]!=="chat-job") throw new Error("Invalid chat job key");
  // Historical requests may answer an idempotent retry, but never recreate a
  // live worker lease or trigger an uncertain model execution.
  const rows=await query("select payload from arena.runtime_history where ns=$1 and kind='chat-job' and id=$2 and (expires_at is null or expires_at>floor(extract(epoch from clock_timestamp())*1000))",[namespace(),location[1]]);
  return rows[0]?.payload as T??null;
}
