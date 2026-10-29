import { db, key } from "./db";
import { ApiError } from "./auth";
import { getContest, registrationKey } from "./rounds";
import type { Registration, SafeUser, Team, Contest } from "./types";

export function approvedTeamOptions(
  teams: Team[],
  registrations: Registration[],
) {
  const approved = new Set(
    registrations.filter((r) => r.status === "approved").map((r) => r.userId),
  );
  return teams
    .flatMap((t) => {
      const members = Array.isArray(t.members) ? t.members : [];
      const count = members.filter((id) => approved.has(id)).length;
      return count
        ? [
            {
              id: t.id,
              name: t.name,
              members: members.length,
              approvedMembers: count,
            },
          ]
        : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}
export async function workspaceTeams(actor: SafeUser, roundId: string) {
  if (!actor.admin)
    throw new ApiError("Chỉ quản trị viên được xem danh sách đội.", 403);
  const c = await getContest(roundId);
  const [teams, registrations] = await Promise.all([
    db().hgetall<Record<string, Team>>(key("teams")),
    db().hgetall<Record<string, Registration>>(registrationKey(c)),
  ]);
  return {
    roundId,
    teams: approvedTeamOptions(
      Object.values(teams ?? {}),
      Object.values(registrations ?? {}),
    ),
  };
}
export async function requireWorkspaceTeam(team: Team, c: Contest) {
  const registrations = await db().hgetall<Record<string, Registration>>(
    registrationKey(c),
  );
  if (!approvedTeamOptions([team], Object.values(registrations ?? {})).length)
    throw new ApiError(
      "Đội chưa có thành viên được duyệt tham gia vòng luyện đã chọn.",
      409,
    );
}

export const WORKSPACE_TEAM_ELIGIBILITY_LUA = `
local function eligible(teamId,teamsKey,regKey)
 local raw=redis.call('HGET',teamsKey,teamId);if not raw then return false end
 local t=cjson.decode(raw);for _,uid in ipairs(t.members) do local r=redis.call('HGET',regKey,uid);if r and cjson.decode(r).status=='approved' then return true end end
 return false
end
`;
