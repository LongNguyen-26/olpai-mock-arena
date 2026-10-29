import { db, key, serverNow } from "./db";
import { ApiError } from "./auth";
import { getAdminIds } from "./admins";
import type { SafeUser, Team, User } from "./types";

export async function adminRoster(actor: SafeUser) {
  if (!actor.admin)
    throw new ApiError("Chỉ quản trị viên được quản lý tài khoản.", 403);
  const [admins, teams] = await Promise.all([
    getAdminIds(),
    db().hgetall<Record<string, Team>>(key("teams")),
  ]);
  if (!admins.includes(actor.id))
    throw new ApiError("Quyền quản trị đã thay đổi.", 403);
  const userKeys: string[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await db().scan(cursor, {
      match: key("user:*"),
      count: 100,
    });
    userKeys.push(...keys);
    cursor = String(next);
  } while (cursor !== "0");
  const users: User[] = [];
  const unique = [...new Set(userKeys)];
  for (let i = 0; i < unique.length; i += 100) {
    const batch = await db().mget<(User | null)[]>(...unique.slice(i, i + 100));
    users.push(
      ...batch.filter((u): u is User => !!u && !admins.includes(u.id)),
    );
  }
  return {
    contestants: users
      .map(({ id, name, username, teamId, createdAt }) => ({
        id,
        name,
        username,
        teamId: teamId ?? null,
        createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi")),
    teams: Object.values(teams ?? {})
      .map((t) => ({
        id: t.id,
        name: t.name,
        captainId: t.captainId,
        members: Array.isArray(t.members) ? t.members : [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi")),
  };
}

export const DELETE_ROSTER_SCRIPT = `
local p=ARGV[1];local actor=ARGV[2];local kind=ARGV[3];local id=ARGV[4]
local function admin(uid) return redis.call('GET',KEYS[1])==uid or redis.call('SISMEMBER',KEYS[2],uid)==1 end
if not admin(actor) then return 'denied' end
local audit={kind=kind,id=id,deletedBy=actor,deletedAt=tonumber(ARGV[5])}
if kind=='contestant' then
 if admin(id) then return 'protected' end
 local raw=redis.call('GET',p..':user:'..id);if not raw then return 'gone' end
 local u=cjson.decode(raw);audit.name=u.name;audit.username=u.username
 if u.teamId and u.teamId~=cjson.null then
  local tr=redis.call('HGET',KEYS[3],u.teamId)
  if tr then local t=cjson.decode(tr);local members={};for _,uid in ipairs(t.members) do if uid~=id then table.insert(members,uid) end end;t.members=members;if t.captainId==id then t.captainId=members[1] or '' end;redis.call('HSET',KEYS[3],t.id,cjson.encode(t)) end
 end
 if redis.call('GET',p..':username:'..u.username)==id then redis.call('DEL',p..':username:'..u.username) end
 redis.call('DEL',p..':user:'..id,p..':invites:'..id)
 for i=5,#KEYS do redis.call('HDEL',KEYS[i],id) end
 for _,rid in ipairs(redis.call('ZRANGE',p..':rounds',0,-1)) do redis.call('HDEL',p..':registrations:'..rid,id) end
elseif kind=='team' then
 local raw=redis.call('HGET',KEYS[3],id);if not raw then return 'gone' end
 local t=cjson.decode(raw);audit.name=t.name;audit.members=t.members
 for _,uid in ipairs(t.members) do
  local rawu=redis.call('GET',p..':user:'..uid)
  if rawu then local u=cjson.decode(rawu);if u.teamId==id then u.teamId=cjson.null;redis.call('SET',p..':user:'..uid,cjson.encode(u)) end end
  redis.call('SREM',p..':invites:'..uid,id)
 end
 if redis.call('GET',p..':code:'..t.inviteCode)==id then redis.call('DEL',p..':code:'..t.inviteCode) end
 redis.call('HDEL',KEYS[3],id)
else return 'invalid' end
redis.call('HSET',KEYS[4],kind..':'..id,cjson.encode(audit));return 'ok'
`;

export async function deleteRosterEntry(
  actor: SafeUser,
  kind: "team" | "contestant",
  id: string,
) {
  if (!actor.admin)
    throw new ApiError("Chỉ quản trị viên được xóa đội/thí sinh.", 403);
  const registrations: string[] = [];
  if (kind === "contestant") {
    let cursor = "0";
    do {
      const [next, keys] = await db().scan(cursor, {
        match: key("registrations:*"),
        count: 100,
      });
      registrations.push(...keys);
      cursor = String(next);
    } while (cursor !== "0");
  }
  const result = await db().eval(
    DELETE_ROSTER_SCRIPT,
    [
      key("admin"),
      key("admins"),
      key("teams"),
      key("admin:deletions"),
      ...new Set(registrations),
    ],
    [key("").slice(0, -1), actor.id, kind, id, await serverNow()],
  );
  if (result === "denied" || result === "protected")
    throw new ApiError("Không được xóa tài khoản quản trị.", 403);
  if (result !== "ok" && result !== "gone")
    throw new ApiError("Không thể xóa mục đã chọn.", 409);
  return { ok: true };
}
