/** Creates the test schema on a NEW disposable local PostgreSQL cluster.
 * Set ARENA_QA_AUTH_DATABASE_URL to a local admin connection first.
 * This does not start PostgreSQL, create hosted resources, or send email.
 */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { authFixturePool } from "./qa-auth-fixtures";
async function main() {
  const pool=authFixturePool();
  try {
    const found=await pool.query("select to_regnamespace('arena') as arena,to_regnamespace('auth') as auth");
    if(found.rows[0].arena || found.rows[0].auth) throw new Error("Use a fresh disposable local database. Existing schemas are never replaced.");
    await pool.query(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
        encrypted_password text,raw_app_meta_data jsonb default '{}'::jsonb,
        deleted_at timestamptz,is_anonymous boolean default false);
      create table auth.identities(user_id uuid,provider text);`);
    for(const file of (await readdir("supabase/migrations")).filter(f=>f.endsWith(".sql")&&!f.includes("backend_bootstrap")).sort()) {
      await pool.query(await readFile(`supabase/migrations/${file}`,"utf8"));
    }
    await pool.query("alter role arena_backend login");
    const admin=new URL(process.env.ARENA_QA_AUTH_DATABASE_URL!),backend=new URL(admin);
    backend.username="arena_backend";backend.password="";
    await mkdir(".local",{recursive:true});
    await writeFile(".local/auth-qa.env",`ARENA_DATABASE_MODE=postgres\nARENA_DATABASE_URL=${backend}\nARENA_QA_AUTH_DATABASE_URL=${admin}\nARENA_RUNPOD_MODE=disabled\n`);
    console.log("Local QA schema ready; configuration saved to .local/auth-qa.env.");
  } finally {await pool.end();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:"QA setup failed");process.exitCode=1;});
