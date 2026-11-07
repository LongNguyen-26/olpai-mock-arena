// Auth fixtures belong only to a disposable, loopback PostgreSQL cluster.
// Never use these helpers against the hosted Supabase Auth database.
import { Pool } from "pg";
import type { User } from "@supabase/supabase-js";
let pool: Pool | undefined;
export function authFixturePool() {
  const value=process.env.ARENA_QA_AUTH_DATABASE_URL;
  if(!value || !["127.0.0.1","localhost"].includes(new URL(value).hostname)) throw new Error("Auth QA requires ARENA_QA_AUTH_DATABASE_URL pointing to disposable local PostgreSQL.");
  const app=process.env.ARENA_DATABASE_URL;
  if(app && !["127.0.0.1","localhost"].includes(new URL(app).hostname)) throw new Error("Auth QA also requires the app database to use disposable local PostgreSQL.");
  return pool ??= new Pool({connectionString:value,max:2,allowExitOnIdle:true});
}
export async function seedAuthFixtures(users:User[]) {
  for(const user of users) await authFixturePool().query(`insert into auth.users(id,email,email_confirmed_at,encrypted_password,raw_app_meta_data)
    values($1,$2,now(),$3,$4) on conflict(id) do nothing`,[user.id,user.email,user.app_metadata.provider==="google"?"":"qa-password-capability",user.app_metadata]);
}
export async function cleanupAuthFixtures(users:User[]) {
  await authFixturePool().query("delete from auth.users where id=any($1::uuid[])",[users.map(u=>u.id)]);
  await pool?.end();pool=undefined;
}
