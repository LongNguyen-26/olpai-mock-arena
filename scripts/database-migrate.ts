/** Explicit, resumable commands. Default import is a dry-run; never prints record values. */
import { randomUUID } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import { exportRedisSnapshot,saveEncryptedSnapshot,loadEncryptedSnapshot,planSnapshot,importSnapshot,verifySnapshot,importColumns } from "../src/lib/database-snapshot";
import { sqlTransaction,closeSqlPools,usingPostgres,namespace } from "../src/lib/sql";
import { db,key } from "../src/lib/db";
import { exportSqlSnapshot,restoreBusinessToRedis } from "../src/lib/database-rollback";

async function main() {
  const mode=process.argv[2];
  const arg=(name:string)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
  const apply=process.argv.includes("--apply"),backup=arg("backup");
  if(mode==="freeze"||mode==="unfreeze") {
    const source=arg("source");if(!source||!apply)throw new Error("Specify --source and --apply");
    process.env.ARENA_NAMESPACE=source;
    if(usingPostgres()) {
      const freezeId=arg("freeze-id")??randomUUID();
      const changed=await sqlTransaction(async client=>{
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[namespace()]);
        return mode==="freeze" ? await client.query("update arena.state set maintenance=true,configuration=jsonb_set(configuration,'{runtimeFreezeId}',to_jsonb($2::text)) where ns=$1 and maintenance=false returning ns",[namespace(),freezeId])
          : await client.query("update arena.state set maintenance=false,configuration=configuration-'runtimeFreezeId' where ns=$1 and maintenance=true and configuration->>'runtimeFreezeId'=$2 returning ns",[namespace(),arg("freeze-id")??""]);
      });
      if(changed.rowCount!==1)throw new Error("Freeze state/ID mismatch; no change");
      console.log(JSON.stringify({frozen:mode==="freeze",sourceNamespace:source,id:freezeId,authority:"postgres"}));return;
    }
    if(mode==="freeze") {
      const freeze={id:randomUUID(),createdAt:Date.now(),reason:"database migration"};
      if(!await db().set(key("database:write-freeze"),freeze,{nx:true}))throw new Error("A write freeze already exists; inspect it before continuing");
      console.log(JSON.stringify({frozen:true,...freeze}));
    } else {
      const id=arg("freeze-id");if(!id)throw new Error("Specify the exact --freeze-id");
      const removed=await db().eval(`local v=redis.call('GET',KEYS[1]);if v and cjson.decode(v).id==ARGV[1] then return redis.call('DEL',KEYS[1]) end;return 0`,[key("database:write-freeze")],[id]);
      if(removed!==1)throw new Error("Freeze ID mismatch; no change");
      console.log(JSON.stringify({unfrozen:true,sourceNamespace:source}));
    }
    return;
  }
  if(mode==="export-sql") {
    const source=arg("source");if(!source)throw new Error("Specify --source");
    process.env.ARENA_NAMESPACE=source;process.env.ARENA_DATABASE_MODE="postgres";
    const snapshot=await sqlTransaction(async client=>{await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[namespace()]);return exportSqlSnapshot();});
    const path=backup??`.local/database-backups/sql-${Date.now()}-${randomUUID()}.json.enc`;
    await saveEncryptedSnapshot(snapshot,path);
    console.log(JSON.stringify({exported:true,authority:"postgres",encrypted:true,backup:path,checksum:snapshot.checksum,records:snapshot.records.length}));return;
  }
  if(mode==="restore-business") {
    const target=arg("target");if(!backup||!target)throw new Error("Specify --backup and --target");
    const snapshot=await loadEncryptedSnapshot(backup);
    if(!apply){console.log(JSON.stringify({dryRun:true,targetNamespace:target,sourceNamespace:snapshot.sourceNamespace}));return;}
    console.log(JSON.stringify(await restoreBusinessToRedis(snapshot,target,process.argv.includes("--production"))));return;
  }
  if(mode==="export") {
    const source=arg("source");if(!source) throw new Error("Specify --source=arena:v1 explicitly");
    const snapshot=await exportRedisSnapshot(source);
    const path=backup??`.local/database-backups/redis-${new Date().toISOString().replaceAll(":","-")}-${randomUUID()}.json.enc`;
    await saveEncryptedSnapshot(snapshot,path);
    const plan=planSnapshot(snapshot);
    console.log(JSON.stringify({exported:true,sourceNamespace:source,backup:path,encrypted:true,records:snapshot.records.length,checksum:snapshot.checksum,frozen:!!snapshot.freezeId,counts:plan.counts,relationshipIssueCount:plan.issues.length}));return;
  }
  if(!["plan","import","verify","cleanup-qa"].includes(mode)) throw new Error("Use export | export-sql | plan | import | verify | restore-business | freeze | unfreeze | cleanup-qa");
  if(mode==="cleanup-qa") {
    const target=arg("target");if(!target||!/^arena:(qa|stage):[a-zA-Z0-9:_-]+$/.test(target)||!apply) throw new Error("Cleanup requires --apply and the exact QA/staging --target namespace");
    process.env.ARENA_NAMESPACE=target;process.env.ARENA_DATABASE_MODE="postgres";
    await sqlTransaction(async client=>{
      const tables=["auth_identities","team_members","team_invites","admins",...Object.keys(importColumns).filter(t=>!["auth_identities","team_members","team_invites","admins"].includes(t)),"migration_runs","state"];
      for(const table of tables) await client.query(`delete from arena.${table} where ns=$1`,[target]);
    },true);
    console.log(JSON.stringify({cleaned:true,targetNamespace:target,productionTouched:false}));return;
  }
  if(!backup) throw new Error("Specify an encrypted --backup path inside .local/database-backups/");
  const snapshot=await loadEncryptedSnapshot(backup),plan=planSnapshot(snapshot);
  if(mode==="plan"||(mode==="import"&&!apply)) {
    console.log(JSON.stringify({dryRun:true,sourceNamespace:snapshot.sourceNamespace,counts:plan.counts,relationshipIssues:plan.issues,frozen:!!snapshot.freezeId,checksum:snapshot.checksum}));return;
  }
  const target=arg("target");if(!target) throw new Error("Specify the target namespace explicitly");
  process.env.ARENA_NAMESPACE=target;process.env.ARENA_DATABASE_MODE="postgres";
  if(mode==="import") console.log(JSON.stringify(await importSnapshot(snapshot,process.argv.includes("--production"))));
  const proof=await verifySnapshot(snapshot);
  await mkdir(".local",{recursive:true});
  await writeFile(".local/supabase-migration-verification.json",JSON.stringify({...proof,sourceChecksum:snapshot.checksum,checkedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify(proof));if(proof.result!=="PASS")process.exitCode=1;
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Database migration failed");process.exitCode=1;}).finally(()=>closeSqlPools());
