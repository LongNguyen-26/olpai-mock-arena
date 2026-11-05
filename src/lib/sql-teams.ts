import { randomBytes, randomUUID } from "node:crypto";
import { namespace, sqlTransaction, sqlNow, bumpRevision } from "./sql";
import { readUser, readUserId, readTeams, readTeam, readInvites, readAdminIds } from "./entity-repository";
import { ApiError } from "./api-error";
type Payload=Parameters<typeof import("./teams").teamAction>[2];

export async function sqlTeamAction(userId:string,action:string,payload:Payload) {
  return sqlTransaction(async client=>{
    const user=await readUser(userId);
    if(!user) throw new ApiError("Tài khoản không còn khả dụng.",401);
    if((await readAdminIds()).includes(userId)) throw new ApiError("Tài khoản quản trị không tham gia đội.",403);
    if(action==="invite") {
      if(!user.teamId) throw new ApiError("Bạn chưa có đội.");
      const target=await readUserId(payload.username?.toLowerCase()??"");
      if(!target) throw new ApiError("Không tìm thấy tài khoản.");
      await client.query("insert into arena.team_invites(ns,user_id,team_id) values($1,$2,$3) on conflict do nothing",[namespace(),target,user.teamId]);
    } else if(action==="decline") {
      if(payload.teamId) await client.query("delete from arena.team_invites where ns=$1 and user_id=$2 and team_id=$3",[namespace(),userId,payload.teamId]);
    } else if(action==="create") {
      if(user.teamId) throw new ApiError("Bạn đang ở một đội. Hãy rời đội trước khi tham gia đội khác.");
      const id=randomUUID();
      await client.query("insert into arena.teams(ns,id,name,captain_id,invite_code,created_at) values($1,$2,$3,$4,$5,$6)",[namespace(),id,payload.name!,userId,randomBytes(6).toString("hex"),await sqlNow(client)]);
      await client.query("insert into arena.team_members(ns,team_id,user_id,position) values($1,$2,$3,0)",[namespace(),id,userId]);
      await client.query("update arena.users set team_id=$3 where ns=$1 and id=$2",[namespace(),userId,id]);
    } else if(action==="join") {
      if(user.teamId) throw new ApiError("Bạn đang ở một đội. Hãy rời đội trước khi tham gia đội khác.");
      const teams=await readTeams();
      const target=payload.code?Object.values(teams).find(t=>t.inviteCode===payload.code!.toLowerCase().trim()):
        (payload.teamId&&(await readInvites(userId)).includes(payload.teamId)?teams[payload.teamId]:null);
      if(!target) throw new ApiError("Mã mời hoặc lời mời không hợp lệ.");
      if(target.members.length>=3) throw new ApiError("Đội đã đủ 3 thành viên.");
      await client.query("insert into arena.team_members(ns,team_id,user_id,position) values($1,$2,$3,$4)",[namespace(),target.id,userId,target.members.length]);
      await client.query("update arena.users set team_id=$3 where ns=$1 and id=$2",[namespace(),userId,target.id]);
      await client.query("delete from arena.team_invites where ns=$1 and user_id=$2 and team_id=$3",[namespace(),userId,target.id]);
    } else if(action==="leave") {
      if(!user.teamId) throw new ApiError("Không tìm thấy đội.");
      const team=await readTeam(user.teamId);
      await client.query("delete from arena.team_members where ns=$1 and team_id=$2",[namespace(),user.teamId]);
      const members=team?.members.filter(id=>id!==userId)??[];
      for(const [position,id] of members.entries()) await client.query("insert into arena.team_members(ns,team_id,user_id,position) values($1,$2,$3,$4)",[namespace(),user.teamId,id,position]);
      if(team?.captainId===userId) await client.query("update arena.teams set captain_id=$3 where ns=$1 and id=$2",[namespace(),user.teamId,members[0]??""]);
      await client.query("update arena.users set team_id=null where ns=$1 and id=$2",[namespace(),userId]);
    } else throw new ApiError("Không thực hiện được thao tác.");
    await bumpRevision(client);
  },true);
}

export async function deleteSqlRosterEntry(actorId:string,kind:"team"|"contestant",id:string) {
  return sqlTransaction(async client=>{
    const admins=await readAdminIds();
    if(!admins.includes(actorId)||admins.includes(id)) throw new ApiError("Không được xóa tài khoản quản trị.",403);
    const now=await sqlNow(client);
    let payload:unknown;
    if(kind==="contestant") {
      const user=await readUser(id); if(!user) return {ok:true};
      payload={kind,id,name:user.name,username:user.username,deletedBy:actorId,deletedAt:now};
      if(user.teamId) await sqlTeamAction(id,"leave",{});
      await client.query("update arena.users set deleted_at=$3,team_id=null where ns=$1 and id=$2",[namespace(),id,now]);
      await client.query("delete from arena.team_invites where ns=$1 and user_id=$2",[namespace(),id]);
      await client.query("delete from arena.registrations where ns=$1 and user_id=$2",[namespace(),id]);
    } else {
      const team=await readTeam(id); if(!team) return {ok:true};
      payload={kind,id,name:team.name,members:team.members,deletedBy:actorId,deletedAt:now};
      await client.query("update arena.users set team_id=null where ns=$1 and team_id=$2",[namespace(),id]);
      await client.query("delete from arena.team_members where ns=$1 and team_id=$2",[namespace(),id]);
      await client.query("delete from arena.team_invites where ns=$1 and team_id=$2",[namespace(),id]);
      await client.query("update arena.teams set deleted_at=$3 where ns=$1 and id=$2",[namespace(),id,now]);
    }
    await client.query("insert into arena.audit_events(ns,id,kind,payload,created_at) values($1,$2,$3,$4,$5)",[namespace(),randomUUID(),`delete-${kind}`,JSON.stringify(payload),now]);
    await bumpRevision(client); return {ok:true};
  },true);
}
