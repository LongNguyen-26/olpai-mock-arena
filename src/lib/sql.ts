import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { supabaseCa } from "./supabase-ca";
import { ApiError } from "./api-error";

export const namespace = () => process.env.ARENA_NAMESPACE ?? "arena:v1";
export function usingPostgres() {
  const mode = process.env.ARENA_DATABASE_MODE ?? "redis";
  if (!["redis", "postgres"].includes(mode)) throw new Error("Invalid ARENA_DATABASE_MODE");
  return mode === "postgres";
}
type Transaction = { client: PoolClient; ns: string; afterCommit: (() => Promise<unknown>)[] };
const context = new AsyncLocalStorage<Transaction>();
const pools = new Map<string, Pool>();
function pool() {
  const connectionString = process.env.ARENA_DATABASE_URL;
  if (!connectionString) throw new Error("Missing server-only ARENA_DATABASE_URL");
  let result = pools.get(connectionString);
  if (!result) {
    const url = new URL(connectionString);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid PostgreSQL URL");
    // URL sslmode parameters override pg's ssl object. Remove them so certificate
    // validation stays enabled instead of silently accepting require/no-verify.
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
    result = new Pool({
      connectionString: url.toString(), max: 3, idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000, allowExitOnIdle: true,
      application_name: "olpai-arena",
      ssl: local ? false : { rejectUnauthorized: true, ...(process.env.ARENA_DATABASE_CA ? { ca: process.env.ARENA_DATABASE_CA.replaceAll("\\n", "\n") } : url.hostname.endsWith(".pooler.supabase.com") ? { ca: supabaseCa } : {}) },
    });
    // Never log a connection string, provider body, parameters, or user content.
    result.on("error", () => console.warn("Arena PostgreSQL idle connection closed"));
    pools.set(connectionString, result);
  }
  return result;
}
export async function sqlTransaction<T>(fn: (client: PoolClient) => Promise<T>, write: boolean | "runtime" = false, bootstrap = false): Promise<T> {
  const ns = namespace(), current = context.getStore();
  if (current) {
    if (current.ns !== ns) throw new Error("Cannot switch namespace within a transaction");
    return fn(current.client);
  }
  const client = await pool().connect();
  const tx: Transaction = { client, ns, afterCommit: [] };
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query("select set_config('arena.namespace',$1,true),set_config('statement_timeout','10s',true),set_config('lock_timeout','5s',true),set_config('extra_float_digits','3',true)", [ns]);
    // One short namespace lock orders policy changes and Redis runtime gates.
    // Never hold this transaction while calling Runpod/Blob or doing inference.
    if (write) {
      // Runtime operations share the policy fence, then lock their own group.
      // Policy/reset writes retain the exclusive namespace lock.
      await client.query(write === "runtime" ? "select pg_advisory_xact_lock_shared(hashtextextended($1,0))" : "select pg_advisory_xact_lock(hashtextextended($1,0))", [ns]);
      const state=await client.query("select maintenance,imported_at from arena.state where ns=$1",[ns]);
      if(!bootstrap&&!ns.startsWith("arena:qa:")&&!state.rows[0]?.imported_at) throw new ApiError("Database chưa được chuyển và đối chiếu. Chưa mở ghi.",503);
      if(state.rows[0]?.maintenance) throw new ApiError("Hệ thống đang chuyển dữ liệu. Vui lòng thử lại sau.",503);
    }
    const value = await context.run(tx, () => fn(client));
    await client.query("COMMIT"); committed = true;
    return value;
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    if (committed) for (const action of tx.afterCommit) {
      // A failed acknowledgement leaves the durable Redis replay marker in place.
      await action().catch(() => console.warn("Arena runtime acknowledgement pending"));
    }
  }
}
export function afterSqlCommit(action: () => Promise<unknown>) {
  const tx = context.getStore();
  if (!tx) throw new Error("Missing transaction context");
  tx.afterCommit.push(action);
}
export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  return sqlTransaction(async client => (await client.query<T>(text, values)).rows);
}
export async function sqlNow(client?: PoolClient) {
  const text = "select floor(extract(epoch from clock_timestamp())*1000)::text as now";
  const rows = client ? (await client.query(text)).rows : await query(text);
  return Number(rows[0].now);
}
export async function bumpRevision(client: PoolClient) {
  await client.query("insert into arena.state(ns,revision) values($1,1) on conflict(ns) do update set revision=arena.state.revision+1", [namespace()]);
}
export async function closeSqlPools() {
  await Promise.all([...pools.values()].map(p => p.end())); pools.clear();
}
