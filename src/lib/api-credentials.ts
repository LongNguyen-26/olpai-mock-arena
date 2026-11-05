import { randomUUID } from "node:crypto";
import { db, key } from "./db";
import { namespace, query, sqlTransaction, usingPostgres } from "./sql";
import { ApiError } from "./api-error";

export interface ApiCredential { ciphertext: string; masked: string; revision: string; updatedAt: number }
export async function readApiCredential(owner: string): Promise<ApiCredential | null> {
  if (!usingPostgres()) return db().get(key(`api:credential:groq:${owner}`));
  return (await query("select configuration from arena.api_credentials where ns=$1 and owner_id=$2 and provider='groq'", [namespace(), owner]))[0]?.configuration ?? null;
}
export async function putApiCredential(owner: string, value: ApiCredential | null) {
  if (!usingPostgres()) {
    if (value) await db().set(key(`api:credential:groq:${owner}`), value);
    else await db().del(key(`api:credential:groq:${owner}`));
    return;
  }
  await sqlTransaction(async client => {
    if (!value) await client.query("delete from arena.api_credentials where ns=$1 and owner_id=$2 and provider='groq'", [namespace(), owner]);
    else await client.query(`insert into arena.api_credentials(ns,owner_id,provider,configuration) values($1,$2,'groq',$3)
      on conflict(ns,owner_id,provider) do update set configuration=excluded.configuration`, [namespace(), owner, JSON.stringify(value)]);
  }, true);
}
// Serializes credential changes and allocation. Pending jobs fence key rotation.
// No inference or provider network call is made while holding this lock.
export async function withGroqOwnerLock<T>(owner: string, fn: () => Promise<T>) {
  const k = key(`api:credential-lock:groq:${owner}`), token = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await db().set(k, token, { nx: true, ex: 60 })) { acquired = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!acquired) throw new ApiError("Cấu hình Groq đang được cập nhật. Vui lòng thử lại.", 409);
  try { return await fn(); }
  finally { await db().eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end;return 0", [k], [token]); }
}
