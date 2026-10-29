import { randomBytes, randomUUID } from "node:crypto";
import { db, key } from "./db";
import { ApiError } from "./auth";
import type { SafeUser, Team } from "./types";
export const TEAM_SCRIPT = `
local rawUser=redis.call('GET',KEYS[1]);if not rawUser then return 'missing' end
local user=cjson.decode(rawUser); local action=ARGV[1]; local teamId=ARGV[2];
if action=='create' then
 if user.teamId~=cjson.null and user.teamId then return 'already' end
 local team=cjson.decode(ARGV[3]); redis.call('HSET',KEYS[2],teamId,ARGV[3]); redis.call('SET',KEYS[3],teamId); user.teamId=teamId;
elseif action=='join' then
 if user.teamId~=cjson.null and user.teamId then return 'already' end
 local raw=redis.call('HGET',KEYS[2],teamId); if not raw then return 'missing' end; local team=cjson.decode(raw);
 if #team.members>=3 then return 'full' end
 table.insert(team.members,user.id); redis.call('HSET',KEYS[2],teamId,cjson.encode(team)); user.teamId=teamId;
elseif action=='leave' then
 if user.teamId==cjson.null or not user.teamId then return 'missing' end
 local raw=redis.call('HGET',KEYS[2],user.teamId);if not raw then user.teamId=cjson.null;redis.call('SET',KEYS[1],cjson.encode(user));return 'ok' end
 local team=cjson.decode(raw); local members={}; for _,id in ipairs(team.members) do if id~=user.id then table.insert(members,id) end end
 team.members=members; if team.captainId==user.id then team.captainId=members[1] or '' end; redis.call('HSET',KEYS[2],user.teamId,cjson.encode(team)); user.teamId=cjson.null;
end
redis.call('SET',KEYS[1],cjson.encode(user)); return 'ok';`;
export async function teamAction(
  user: SafeUser,
  action: string,
  payload: {
    action?: string;
    name?: string;
    code?: string;
    teamId?: string;
    username?: string;
  },
) {
  if (action === "invite") {
    if (!user.teamId) throw new ApiError("Bạn chưa có đội.");
    const id = await db().get<string>(
      key(`username:${payload.username?.toLowerCase()}`),
    );
    if (!id) throw new ApiError("Không tìm thấy tài khoản.");
    await db().sadd(key(`invites:${id}`), user.teamId);
    return;
  }
  if (action === "decline") {
    if (payload.teamId)
      await db().srem(key(`invites:${user.id}`), payload.teamId);
    return;
  }
  let teamId = "",
    team: Team | null = null;
  if (action === "create") {
    teamId = randomUUID();
    team = {
      id: teamId,
      name: payload.name!,
      captainId: user.id,
      members: [user.id],
      inviteCode: randomBytes(6).toString("hex"),
      createdAt: Date.now(),
    };
  }
  if (action === "join") {
    if (payload.code)
      teamId =
        (await db().get<string>(
          key(`code:${payload.code.toLowerCase().trim()}`),
        )) ?? "";
    else if (
      payload.teamId &&
      (await db().sismember(key(`invites:${user.id}`), payload.teamId))
    )
      teamId = payload.teamId;
    if (!teamId) throw new ApiError("Mã mời hoặc lời mời không hợp lệ.");
  }
  const result = await db().eval<unknown[], string>(
    TEAM_SCRIPT,
    [
      key(`user:${user.id}`),
      key("teams"),
      key(`code:${team?.inviteCode ?? "unused"}`),
    ],
    [action, teamId, JSON.stringify(team)],
  );
  if (result !== "ok")
    throw new ApiError(
      (
        {
          already:
            "Bạn đang ở một đội. Hãy rời đội trước khi tham gia đội khác.",
          full: "Đội đã đủ 3 thành viên.",
          missing: "Không tìm thấy đội.",
        } as Record<string, string>
      )[result] ?? "Không thực hiện được thao tác.",
    );
  if (action === "join") await db().srem(key(`invites:${user.id}`), teamId);
}
