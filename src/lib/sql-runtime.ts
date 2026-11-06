import { namespace, query, sqlTransaction } from "./sql";

export async function sessionUser(hash: string) {
  return (await query("select user_id from arena.sessions where ns=$1 and token_hash=$2 and expires_at>floor(extract(epoch from clock_timestamp())*1000)", [namespace(), hash]))[0]?.user_id as string | undefined;
}
export async function saveSession(hash: string, user: string, expiresAt: number) {
  await query("insert into arena.sessions(ns,token_hash,user_id,expires_at) values($1,$2,$3,$4) on conflict(ns,token_hash) do update set user_id=excluded.user_id,expires_at=excluded.expires_at", [namespace(), hash, user, expiresAt]);
}
export async function removeSession(hash: string) {
  await query("delete from arena.sessions where ns=$1 and token_hash=$2", [namespace(), hash]);
}
// Expiry is checked atomically, not by a cleanup timer. The optional ceiling
// reserves a provider request without incrementing a counter already at its cap.
export async function consumeCounter(id: string, seconds: number, ceiling?: number) {
  const rows = await query(`insert into arena.rate_counters(ns,id,count,expires_at)
    values($1,$2,1,floor(extract(epoch from clock_timestamp())*1000)+$3::bigint)
    on conflict(ns,id) do update set
      count=case when arena.rate_counters.expires_at<=floor(extract(epoch from clock_timestamp())*1000) then 1 else arena.rate_counters.count+1 end,
      expires_at=case when arena.rate_counters.expires_at<=floor(extract(epoch from clock_timestamp())*1000) then excluded.expires_at else arena.rate_counters.expires_at end
    where $4::integer is null or arena.rate_counters.count<$4 or arena.rate_counters.expires_at<=floor(extract(epoch from clock_timestamp())*1000)
    returning count`, [namespace(), id, seconds * 1000, ceiling ?? null]);
  return rows.length ? Number(rows[0].count) : null;
}
export async function refundCounter(id: string) {
  await query("update arena.rate_counters set count=greatest(0,count-1) where ns=$1 and id=$2", [namespace(), id]);
}
export async function acquireLease(id: string, token: string, seconds: number) {
  return !!(await query(`insert into arena.runtime_leases(ns,id,token,expires_at)
    values($1,$2,$3,floor(extract(epoch from clock_timestamp())*1000)+$4::bigint)
    on conflict(ns,id) do update set token=excluded.token,expires_at=excluded.expires_at
    where arena.runtime_leases.expires_at<=floor(extract(epoch from clock_timestamp())*1000) returning id`, [namespace(), id, token, seconds * 1000])).length;
}
export async function releaseLease(id: string, token: string) {
  await query("delete from arena.runtime_leases where ns=$1 and id=$2 and token=$3", [namespace(), id, token]);
}
export async function runtimeSignal(id: string): Promise<string | null> {
  return (await query("select value from arena.runtime_signals where ns=$1 and id=$2 and expires_at>floor(extract(epoch from clock_timestamp())*1000)", [namespace(), id]))[0]?.value ?? null;
}
export async function saveRuntimeSignal(id: string, value: string, seconds: number) {
  await query(`insert into arena.runtime_signals(ns,id,value,expires_at) values($1,$2,$3,floor(extract(epoch from clock_timestamp())*1000)+$4::bigint)
    on conflict(ns,id) do update set value=excluded.value,expires_at=greatest(arena.runtime_signals.expires_at,excluded.expires_at)`, [namespace(), id, value, seconds * 1000]);
}
export async function clearRuntimeSignal(id: string) {
  await query("delete from arena.runtime_signals where ns=$1 and id=$2", [namespace(), id]);
}
export async function cleanupSqlRuntime() {
  await sqlTransaction(async client => {
    for (const table of ["sessions", "rate_counters", "runtime_leases", "runtime_signals", "requests", "runtime_history"])
      await client.query(`delete from arena.${table} where ctid in (select ctid from arena.${table} where ns=$1 and expires_at<floor(extract(epoch from clock_timestamp())*1000) limit 200)`, [namespace()]);
  });
}
