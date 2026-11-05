import { db, key } from "./db";
import { namespace, usingPostgres, query, sqlTransaction, bumpRevision, sqlNow } from "./sql";
import { ApiError } from "./api-error";
import type { Contest, ContestPackage, Registration, Submission, Team, User } from "./types";

export const legacyRoundId = "__legacy__";
export const roundIdOf = (c: Contest) => c.roundId ?? legacyRoundId;
export function userFromRow(r: Record<string, unknown>): User {
  return { id: String(r.id), username: String(r.username), name: String(r.name),
    password: String(r.password_hash), teamId: r.team_id == null ? null : String(r.team_id), createdAt: Number(r.created_at) };
}
export async function readUser(id: string): Promise<User | null> {
  if (!usingPostgres()) return db().get<User>(key(`user:${id}`));
  const rows = await query("select * from arena.users where ns=$1 and id=$2 and deleted_at is null", [namespace(), id]);
  return rows[0] ? userFromRow(rows[0]) : null;
}
export async function readUserId(username: string) {
  if (!usingPostgres()) return db().get<string>(key(`username:${username.toLowerCase()}`));
  const rows = await query("select id from arena.users where ns=$1 and lower(username)=$2 and deleted_at is null", [namespace(), username.toLowerCase()]);
  return rows[0]?.id as string | undefined ?? null;
}
export async function readAdminIds() {
  if (!usingPostgres()) {
    const [primary, additional] = await Promise.all([db().get<string>(key("admin")), db().smembers<string[]>(key("admins"))]);
    return [...new Set([...(primary ? [primary] : []), ...additional])];
  }
  return (await query("select a.user_id from arena.admins a join arena.users u on u.ns=a.ns and u.id=a.user_id where a.ns=$1 and u.deleted_at is null order by a.is_primary desc,a.user_id", [namespace()])).map(r => String(r.user_id));
}
export async function readTeams(): Promise<Record<string, Team>> {
  if (!usingPostgres()) return (await db().hgetall<Record<string, Team>>(key("teams"))) ?? {};
  const rows = await query("select t.*,coalesce((select jsonb_agg(m.user_id order by m.position) from arena.team_members m where m.ns=t.ns and m.team_id=t.id),'[]'::jsonb) members from arena.teams t where t.ns=$1 and t.deleted_at is null", [namespace()]);
  return Object.fromEntries(rows.map(r => [r.id, { id:r.id,name:r.name,captainId:r.captain_id,inviteCode:r.invite_code,createdAt:Number(r.created_at),members:r.members } as Team]));
}
export async function readTeam(id: string) { return (await readTeams())[id] ?? null; }
export async function readInvites(userId: string): Promise<string[]> {
  if (!usingPostgres()) return db().smembers<string[]>(key(`invites:${userId}`));
  return (await query("select team_id from arena.team_invites where ns=$1 and user_id=$2", [namespace(),userId])).map(r=>String(r.team_id));
}
export async function readRound(id?: string): Promise<Contest | null> {
  if (!usingPostgres()) return db().get<Contest>(id ? key(`round:${id}`) : key("contest"));
  const rows = await query("select configuration from arena.rounds where ns=$1 and id=$2", [namespace(),id ?? legacyRoundId]);
  return rows[0]?.configuration as Contest ?? null;
}
export async function readRoundIds(): Promise<string[]> {
  if (!usingPostgres()) return db().zrange<string[]>(key("rounds"),0,-1,{rev:true});
  return (await query("select id from arena.rounds where ns=$1 and catalog_score is not null order by catalog_score desc,id desc", [namespace()])).map(r=>String(r.id));
}
export async function readRounds(ids:string[]):Promise<(Contest|null)[]> {
  if(!ids.length) return [];
  if(!usingPostgres()) return db().mget<(Contest|null)[]>(...ids.map(id=>key(`round:${id}`)));
  const rows=await query("select id,configuration from arena.rounds where ns=$1 and id=any($2::text[])",[namespace(),ids]);
  const found=new Map(rows.map(r=>[r.id,r.configuration as Contest]));return ids.map(id=>found.get(id)??null);
}
export async function readPackage(id?: string): Promise<ContestPackage | null> {
  if (!usingPostgres()) return db().get<ContestPackage>(key(id ? `package:${id}` : "package"));
  const rows = await query("select configuration from arena.packages where ns=$1 and id=$2", [namespace(),id ?? legacyRoundId]);
  return rows[0]?.configuration as ContestPackage ?? null;
}
export async function readPackageCatalogue(): Promise<Record<string,string>> {
  if (!usingPostgres()) return (await db().hgetall<Record<string,string>>(key("packages"))) ?? {};
  return Object.fromEntries((await query("select id,title from arena.packages where ns=$1 and listed order by imported_at,id", [namespace()])).map(r=>[r.id,r.title]));
}
export async function readRegistrations(c: Contest): Promise<Record<string,Registration>> {
  if (!usingPostgres()) return (await db().hgetall<Record<string,Registration>>(key(`registrations:${c.roundId ?? c.id}`))) ?? {};
  const rows = await query("select user_id,status,registered_at from arena.registrations where ns=$1 and round_id=$2", [namespace(),c.roundId ?? c.id]);
  return Object.fromEntries(rows.map(r=>[r.user_id,{userId:r.user_id,status:r.status,registeredAt:Number(r.registered_at)} as Registration]));
}
export async function readRegistration(c: Contest, userId: string) { return (await readRegistrations(c))[userId] ?? null; }
export function submissionFromRow(r: Record<string,unknown>): Submission {
  return { id:String(r.id),runId:String(r.run_id),teamId:String(r.actor_id),userId:String(r.user_id),
    task:r.task as Submission["task"],split:r.split as Submission["split"],filename:String(r.filename),createdAt:Number(r.created_at),
    score:Number(r.score),secondary:Number(r.secondary),...(r.metric == null ? {} : { metric:Number(r.metric) }),
    bytes:Number(r.bytes),sha256:String(r.sha256),path:String(r.path),...(r.file_storage ? {fileStorage:r.file_storage as "redis"} : {}),
    note:String(r.note),...(r.status ? {status:r.status as Submission["status"]} : {}),...(r.error == null ? {} : {error:String(r.error)}),adminTest:!!r.admin_test };
}
export async function readSubmissions(runId: string): Promise<Submission[]> {
  if (!usingPostgres()) return Object.values((await db().hgetall<Record<string,Submission>>(key(`submissions:${runId}`))) ?? {});
  return (await query("select * from arena.submissions where ns=$1 and run_id=$2 order by created_at desc,id", [namespace(),runId])).map(submissionFromRow);
}
export async function readSubmission(runId: string,id: string) {
  if (!usingPostgres()) return db().hget<Submission>(key(`submissions:${runId}`),id);
  const rows=await query("select * from arena.submissions where ns=$1 and run_id=$2 and id=$3",[namespace(),runId,id]);
  return rows[0] ? submissionFromRow(rows[0]) : null;
}
export async function readAnnouncements(runId: string) {
  if (!usingPostgres()) return db().lrange<{id:string;text:string;createdAt:number}>(key(`announcements:${runId}`),0,19);
  return (await query("select id,text,created_at from arena.announcements where ns=$1 and run_id=$2 order by created_at desc,id limit 20",[namespace(),runId])).map(r=>({id:r.id as string,text:r.text as string,createdAt:Number(r.created_at)}));
}
export async function createSqlUser(user: User, admin?: "primary"|"additional") {
  return sqlTransaction(async client=>{
    const existing=await client.query("select id from arena.users where ns=$1 and lower(username)=lower($2) and deleted_at is null",[namespace(),user.username]);
    if(existing.rowCount) return false;
    await client.query("insert into arena.users(ns,id,username,name,password_hash,team_id,created_at) values($1,$2,$3,$4,$5,$6,$7)",[namespace(),user.id,user.username,user.name,user.password,user.teamId,user.createdAt]);
    if(admin) await client.query("insert into arena.admins(ns,user_id,is_primary) values($1,$2,$3)",[namespace(),user.id,admin==="primary"]);
    await bumpRevision(client); return true;
  },true);
}
export async function changeSqlPassword(userId:string,expectedHash:string,hash:string) {
  return sqlTransaction(async client=>{
    const r=await client.query("update arena.users set password_hash=$4 where ns=$1 and id=$2 and password_hash=$3 and deleted_at is null",[namespace(),userId,expectedHash,hash]);
    if(!r.rowCount) throw new ApiError("Tài khoản vừa thay đổi. Hãy đăng nhập lại.",409);
    await bumpRevision(client);
  },true);
}
export async function readSqlUsers() { return (await query("select * from arena.users where ns=$1 and deleted_at is null",[namespace()])).map(userFromRow); }
export async function saveSqlPackage(pkg:ContestPackage,listed=true,id=pkg.version,immutable=false) {
  return sqlTransaction(async client=>{
    if(immutable&&(await readPackage(id))) throw new ApiError("Version already exists. Use a new immutable version.",409);
    await client.query("insert into arena.packages(ns,id,title,statement,imported_at,listed,configuration) values($1,$2,$3,$4,$5,$6,$7) on conflict(ns,id) do update set title=excluded.title,statement=excluded.statement,imported_at=excluded.imported_at,listed=excluded.listed,configuration=excluded.configuration",[namespace(),id,pkg.title??pkg.version,pkg.statement,pkg.importedAt,listed,JSON.stringify(pkg)]);
    await bumpRevision(client);
  },true);
}
export async function sqlWritable() {
  const rows=await query("select maintenance from arena.state where ns=$1",[namespace()]);
  if(rows[0]?.maintenance) throw new ApiError("Hệ thống đang chuyển dữ liệu. Vui lòng thử lại sau.",503);
}
