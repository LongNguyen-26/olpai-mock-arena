import { createHash, randomUUID } from "node:crypto";
import { db,key } from "./db";
import { memoRead } from "./read-scope";
import type { PoolClient } from "pg";
import { namespace, sqlTransaction, sqlNow, bumpRevision } from "./sql";
import { readRound, readPackage, readUser, readAdminIds, readRegistration, readSubmission, roundIdOf } from "./entity-repository";
import { ApiError } from "./api-error";
import { applyPrivateTransition, phaseOf, submissionAccess } from "./domain";
import { guardedRoundActions, roundControlSchema, reduceRoundControl, resetRound } from "./round-control";
import { roundVisible } from "./round-visibility";
import { taskStatements } from "./statements";
import type { Contest, Submission } from "./types";
type Values = Parameters<typeof import("./rounds").control>[1];

export async function putSqlRound(client:PoolClient,c:Contest,catalogScore?:number|null) {
  await client.query(`insert into arena.rounds(ns,id,run_id,package_id,title,revision,chat_epoch,catalog_score,created_at,configuration)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(ns,id) do update set
    run_id=excluded.run_id,package_id=excluded.package_id,title=excluded.title,revision=excluded.revision,
    chat_epoch=excluded.chat_epoch,configuration=excluded.configuration`,
  [namespace(),roundIdOf(c),c.id,c.packageId??null,c.title,c.revision??0,c.chatEpoch??0,catalogScore??null,c.createdAt,JSON.stringify(c)]);
}
export async function archiveSqlRun(client:PoolClient,c:Contest) {
  await client.query("insert into arena.runs(ns,id,round_id,configuration) values($1,$2,$3,$4) on conflict(ns,id) do update set configuration=excluded.configuration",[namespace(),c.id,c.roundId??null,JSON.stringify(c)]);
}
export async function getSqlContest(id?:string):Promise<Contest> {
  return memoRead(`contest:${id??"__legacy__"}`,()=>sqlTransaction(async client=>{
    const c=await readRound(id);
    if(!c || !roundVisible(c,true)) throw new ApiError("Không tìm thấy vòng luyện.",404);
    const current=applyPrivateTransition(c,await sqlNow(client));
    if(current!==c && !await db().get(key("database:write-freeze"))) { await putSqlRound(client,current); await bumpRevision(client); }
    return current;
  },true));
}
export async function createSqlRound(title:string,packageId:string) {
  return sqlTransaction(async client=>{
    const pkg=await readPackage(packageId);
    if(!pkg) throw new ApiError("Không tìm thấy bộ đề.");
    const id=randomUUID(),now=await sqlNow(client);
    const c:Contest={id:randomUUID(),roundId:id,packageId,title,startAt:null,privateAt:null,forcedEndAt:null,
      unlimited:false,autoApprove:true,taskCount:taskStatements(pkg).length,publicSeconds:18000,privateSeconds:3600,
      publicLimit:20,privateLimit:5,createdAt:now};
    await putSqlRound(client,c,now); await bumpRevision(client); return {id};
  },true);
}
export async function registerSqlRound(userId:string,id:string) {
  return sqlTransaction(async client=>{
    const c=await getSqlContest(id),user=await readUser(userId);
    if(!user) throw new ApiError("Tài khoản không còn khả dụng.",401);
    if((await readAdminIds()).includes(userId)) throw new ApiError("Tài khoản quản trị không cần đăng ký.");
    if(!roundVisible(c)) throw new ApiError("Không tìm thấy vòng luyện.",404);
    await client.query(`insert into arena.registrations(ns,round_id,user_id,status,registered_at) values($1,$2,$3,$4,$5)
      on conflict(ns,round_id,user_id) do update set status=excluded.status,registered_at=excluded.registered_at
      where arena.registrations.status='rejected'`,[namespace(),c.roundId??c.id,userId,c.autoApprove===false?"pending":"approved",await sqlNow(client)]);
    await bumpRevision(client);
  },true);
}
export async function reviewSqlRegistration(roundId:string,userId:string,status:string) {
  return sqlTransaction(async client=>{
    const c=await getSqlContest(roundId);
    const result=await client.query("update arena.registrations set status=$4 where ns=$1 and round_id=$2 and user_id=$3",[namespace(),c.roundId??c.id,userId,status]);
    if(!result.rowCount) throw new ApiError("Không tìm thấy đăng ký.",404);
    await bumpRevision(client);
  },true);
}
export async function controlSqlRound(action:string,values:Values,id:string) {
  return sqlTransaction(async client=>{
    const guarded=guardedRoundActions.includes(action);
    const v=guarded?roundControlSchema.parse({...values,action}):null;
    const fingerprint=v?createHash("sha256").update(JSON.stringify(v)).digest("hex"):"";
    const requestId=v?`${id}:${v.requestId}`:action==="grant-quota"?`${values.runId}:${values.requestId}`:"";
    const scope=action==="grant-quota"?"quota-grant":"round-control";
    const signature=action==="grant-quota"?`${values.runId}:${values.split}:${values.amount}`:fingerprint;
    if(requestId) {
      const old=await client.query("select fingerprint from arena.requests where ns=$1 and scope=$2 and id=$3",[namespace(),scope,requestId]);
      if(old.rows[0]) { if(old.rows[0].fingerprint!==signature) throw new ApiError("Mã yêu cầu đã được dùng cho thao tác khác.",409); return; }
    }
    const c=await getSqlContest(id),now=await sqlNow(client),phase=phaseOf(c,now);
    let next={...c};
    if(v) {
      if(c.id!==v.runId || (c.revision??0)!==v.revision) throw new ApiError("Vòng luyện vừa được cập nhật. Hãy tải lại.",409);
      if(v.action==="practice-open" && !(await readPackage(c.packageId))) throw new ApiError("Chưa nạp bộ đề.",409);
      next=reduceRoundControl(c,v,now);
      if(action==="reset-round") await archiveSqlRun(client,c);
    } else if(action==="grant-quota") {
      if(values.runId!==c.id || !values.requestId || !["public","private"].includes(values.split??"") || !Number.isInteger(values.amount) || values.amount!<1 || values.amount!>100) throw new ApiError("Yêu cầu tăng quota không hợp lệ hoặc lượt luyện đã thay đổi.",409);
      if(!["public","private","practice"].includes(phase)) throw new ApiError("Chỉ tăng quota khi vòng luyện đang mở.",409);
      const field=values.split==="private"?"privateLimit":"publicLimit";
      if(c[field]+values.amount!>1000) throw new ApiError("Quota tối đa là 1.000 lượt mỗi tác vụ.",409);
      next[field]+=values.amount!; next.revision=(c.revision??0)+1;
    } else if(action==="announce") {
      await client.query("insert into arena.announcements(ns,run_id,id,text,created_at) values($1,$2,$3,$4,$5)",[namespace(),c.id,randomUUID(),values.text??"",now]); return;
    } else if(action==="visibility") {
      if(typeof values.hidden!=="boolean") throw new ApiError("Chọn trạng thái hiển thị."); next.hidden=values.hidden;
    } else if(action==="configure") {
      if(!["waiting","scheduled"].includes(phase)) throw new ApiError("Chỉ sửa thiết lập trước khi vòng bắt đầu.");
      next={...c,title:values.title!,publicSeconds:values.publicSeconds!,privateSeconds:values.privateSeconds!,
        publicLimit:values.publicLimit!,privateLimit:values.privateLimit!,unlimited:values.unlimited??false,autoApprove:values.autoApprove??true};
    } else if(action==="approval-mode") next.autoApprove=values.autoApprove??true;
    else if(action==="start" || action==="schedule") {
      if(!["waiting","scheduled"].includes(phase)) throw new ApiError("Vòng luyện đã bắt đầu.");
      if(!(await readPackage(c.packageId))) throw new ApiError("Chưa nạp bộ đề.");
      const start=action==="start"?now:Date.parse(values.scheduledAt!);
      if(!Number.isFinite(start)||start<now) throw new ApiError("Giờ hẹn phải ở tương lai.");
      next={...c,startAt:start,privateAt:null,forcedEndAt:null};
    } else if(action==="cancel") { if(phase!=="scheduled") throw new ApiError("Không có lịch hẹn."); next.startAt=null; }
    else if(action==="finish") {
      if(!["public","private"].includes(phase)) throw new ApiError("Vòng luyện chưa bắt đầu.");
      next.forcedEndAt=now; next.chatEpoch=(c.chatEpoch??0)+1;
    } else if(action==="reset" || action==="new") next=resetRound(c,now,values.keepLeaderboard===true);
    else throw new ApiError("Thao tác không hợp lệ.");
    if(!v && action!=="grant-quota") { next.revision=(c.revision??0)+1; await archiveSqlRun(client,c); }
    await putSqlRound(client,next); await bumpRevision(client);
    if(requestId) await client.query("insert into arena.requests(ns,scope,id,fingerprint,result) values($1,$2,$3,$4,'true'::jsonb)",[namespace(),scope,requestId,signature]);
  },true);
}
export const submissionRequestId=(s:Pick<Submission,"runId"|"teamId"|"task"|"split">,nonce:string)=>`${s.runId}:${s.teamId}:${s.task}:${s.split}:${nonce}`;
export async function findSqlSubmissionRequest(s:Pick<Submission,"runId"|"teamId"|"task"|"split">,nonce:string) {
  return sqlTransaction(async client=>{
    const old=await client.query("select result from arena.requests where ns=$1 and scope='submission' and id=$2",[namespace(),submissionRequestId(s,nonce)]);
    return old.rows[0]?.result ? readSubmission(s.runId,old.rows[0].result as string) : null;
  });
}
export async function insertSqlSubmission(client:PoolClient,s:Submission) {
  await client.query(`insert into arena.submissions(ns,id,run_id,actor_id,user_id,task,split,filename,created_at,score,secondary,metric,bytes,sha256,path,file_storage,note,status,error,admin_test)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
  [namespace(),s.id,s.runId,s.teamId,s.userId,s.task,s.split,s.filename,s.createdAt,s.score,s.secondary,s.metric??null,s.bytes,s.sha256,s.path,s.fileStorage??null,s.note,s.status??null,s.error??null,!!s.adminTest]);
}
export async function commitSqlSubmission(s:Submission,roundId:string,nonce:string) {
  return sqlTransaction(async client=>{
    const prior=await findSqlSubmissionRequest(s,nonce); if(prior) return prior.id;
    const c=await getSqlContest(roundId),user=await readUser(s.userId),now=await sqlNow(client);
    if(c.id!==s.runId) throw new ApiError("Vòng luyện đã được mở lại. Hãy nộp lại.",409);
    if(!user) throw new ApiError("Tài khoản không còn khả dụng.",401);
    const admin=(await readAdminIds()).includes(user.id);
    if(s.adminTest&&!admin) throw new ApiError("Quyền tài khoản đã thay đổi.",409);
    if(!admin) {
      if(!submissionAccess(c,now,s.split).accepting) throw new ApiError("Đã hết thời gian nhận bài cho tập này.",409);
      if(user.teamId!==s.teamId) throw new ApiError("Bạn đã đổi đội trong lúc chấm. Hãy nộp lại.",409);
      if((await readRegistration(c,user.id))?.status!=="approved") throw new ApiError("Đăng ký tham gia không còn được duyệt.",409);
      if(s.status!=="invalid") {
        const limit=s.split==="private"?c.privateLimit:c.publicLimit;
        const q=await client.query(`insert into arena.submission_quotas(ns,run_id,actor_id,task,split,used) select $1,$2,$3,$4,$5,1 where $6>0
          on conflict(ns,run_id,actor_id,task,split) do update set used=arena.submission_quotas.used+1
          where arena.submission_quotas.used<$6 returning used`,[namespace(),s.runId,s.teamId,s.task,s.split,limit]);
        if(!q.rowCount) throw new ApiError("Đội đã dùng hết lượt nộp.",409);
      }
    }
    await insertSqlSubmission(client,{...s,createdAt:now});
    await client.query("insert into arena.requests(ns,scope,id,fingerprint,result) values($1,'submission',$2,$2,$3)",[namespace(),submissionRequestId(s,nonce),JSON.stringify(s.id)]);
    return s.id;
  },true);
}
