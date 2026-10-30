import { randomUUID } from "node:crypto";
import { db, key, serverNow } from "./db";
import { ApiError } from "./auth";
import { registrationKey, roundKey } from "./rounds";
import type { Contest, SafeUser, Team } from "./types";
import type { Workspace } from "./workspace-domain";
import {
  isTeamHub,
  notebookReport,
  type HubReport,
  type TeamNotebook,
  type GpuTurn,
} from "./hub-domain";

export const hubReportKey = (id: string) => key(`gpu:hub:report:${id}`);
export const hubTurnKey = (id: string, run: string, epoch = 0) =>
  key(`gpu:hub:turns:${id}:${run}:${epoch}`);
export async function readHubReport(id: string) {
  return db().get<HubReport>(hubReportKey(id));
}
export async function readGpuTurns(id: string, run: string, epoch = 0) {
  return Object.values(
    (await db().hgetall<Record<string, GpuTurn>>(hubTurnKey(id, run, epoch))) ??
      {},
  ).sort(
    (a, b) => a.requestedAt - b.requestedAt || a.teamId.localeCompare(b.teamId),
  );
}
export function hubVisible(w: Workspace, user: SafeUser) {
  return (
    !isTeamHub(w) ||
    user.admin ||
    !!(user.teamId && w.hubTeams?.[user.teamId]?.enabled)
  );
}
export function hubBound(w: Workspace) {
  return !w.manual || w.manual.state === "bound";
}
export async function hubView(
  w: Workspace,
  user: SafeUser,
  now: number,
  epoch = 0,
) {
  if (!isTeamHub(w)) return undefined;
  const [report, turns] = await Promise.all([
    readHubReport(w.id),
    readGpuTurns(w.id, w.runId, epoch),
  ]);
  const fresh = report?.runId === w.runId && now - report.observedAt <= 45000;
  return {
    hostId: w.id,
    maxTeamServers: w.template.maxTeamServers ?? 7,
    canManage: user.admin && w.ownerId === user.id,
    hubReady: !!(fresh && report.hubReady),
    observedAt: report?.observedAt ?? null,
    resources:
      user.admin || w.metricsVisible !== false
        ? fresh
          ? report.resources
          : null
        : null,
    teams: Object.values(w.hubTeams ?? {})
      .filter((t) => user.admin || t.teamId === user.teamId)
      .map((t) => {
        const server = notebookReport(w, report, t.teamId, w.runId, now);
        return {
          ...t,
          server:
            server && !user.admin && server.error
              ? {
                  ...server,
                  error:
                    "JupyterLab cần được kiểm tra. Vui lòng báo quản trị viên.",
                }
              : server,
        };
      }),
    turns: turns.filter((t) => w.hubTeams?.[t.teamId]?.enabled),
  };
}

// Every write rechecks round/run and membership in Redis, after the HTTP checks.
const AUTHORITY = `
local raw=redis.call('GET',KEYS[1]);if not raw then return 'missing' end
local w=cjson.decode(raw);local round=redis.call('GET',KEYS[2]);
if not round or cjson.decode(round).id~=ARGV[1] or w.runId~=ARGV[1] then return 'run' end
if (cjson.decode(round).chatEpoch or 0)~=tonumber(ARGV[#ARGV]) then return 'run' end
if w.jupyterMode~='team-hub' or w.status=='terminated' or (w.manual and w.manual.state~='bound') then return 'inactive' end
if ARGV[3]~='' then
 local team=redis.call('HGET',KEYS[3],ARGV[2]);local reg=redis.call('HGET',KEYS[4],ARGV[3]);local member=false
 if team then for _,uid in ipairs(cjson.decode(team).members) do if uid==ARGV[3] then member=true end end end
 if not member or not reg or cjson.decode(reg).status~='approved' then return 'member' end
end
`;
function writeError(result: string) {
  if (result === "run")
    throw new ApiError("Lượt luyện vừa thay đổi. Hãy tải lại.", 409);
  if (["missing", "inactive", "member", "disabled"].includes(result))
    throw new ApiError("Không có quyền điều khiển workspace này.", 403);
  if (result === "revision")
    throw new ApiError("Workspace vừa thay đổi. Hãy tải lại.", 409);
  if (result === "request")
    throw new ApiError("Mã yêu cầu đã được sử dụng cho thao tác khác.", 409);
}
export async function mutateNotebook(
  w: Workspace,
  c: Contest,
  user: SafeUser,
  teamId: string,
  action: "grant" | "revoke" | "start" | "stop",
  requestId: string,
  expectedRevision?: string,
  team?: Team,
) {
  const now = await serverNow();
  const next: TeamNotebook = {
    teamId,
    teamName: team?.name ?? w.hubTeams?.[teamId]?.teamName ?? "",
    enabled: action !== "revoke",
    desiredState: action === "start" ? "running" : "stopped",
    revision: randomUUID(),
    updatedAt: now,
  };
  const signature = JSON.stringify([
    user.id,
    w.runId,
    teamId,
    action,
    expectedRevision ?? "",
    c.chatEpoch ?? 0,
  ]);
  const result = await db().eval<unknown[], string>(
    AUTHORITY +
      `
local prior=redis.call('GET',KEYS[5]);if prior then local p=cjson.decode(prior);if p.signature~=ARGV[8] then return 'request' end;return p.value end
w.hubTeams=w.hubTeams or {};local old=w.hubTeams[ARGV[2]]
if ARGV[7]~='' and (not old or old.revision~=ARGV[7]) then return 'revision' end
if ARGV[4]~='grant' and (not old or (ARGV[4]=='start' and not old.enabled)) then return 'disabled' end
local next=cjson.decode(ARGV[5]);
if old and ARGV[4]=='grant' and old.enabled then next=old end
if old and (ARGV[4]=='start' or ARGV[4]=='stop') then next.enabled=old.enabled;next.teamName=old.teamName;if next.desiredState==old.desiredState then next=old end end
w.hubTeams[ARGV[2]]=next;w.updatedAt=tonumber(ARGV[6]);redis.call('SET',KEYS[1],cjson.encode(w));local encoded=cjson.encode(next)
redis.call('SET',KEYS[5],cjson.encode({signature=ARGV[8],value=encoded}),'EX',86400);return encoded`,
    [
      key(`gpu:workspace:${w.id}`),
      roundKey(c),
      key("teams"),
      registrationKey(c),
      key(`gpu:hub:op:${w.id}:${requestId}`),
    ],
    [
      w.runId,
      teamId,
      user.admin ? "" : user.id,
      action,
      JSON.stringify(next),
      now,
      expectedRevision ?? "",
      signature,
      c.chatEpoch ?? 0,
    ],
  );
  writeError(result);
  return typeof result === "string"
    ? (JSON.parse(result) as TeamNotebook)
    : result;
}
export async function gpuTurn(
  w: Workspace,
  c: Contest,
  user: SafeUser,
  action: "request" | "start" | "release" | "cancel",
  requestId: string,
) {
  const teamId = user.teamId;
  if (!teamId) throw new ApiError("Bạn cần thuộc một đội.", 403);
  const now = await serverNow(),
    signature = JSON.stringify([
      user.id,
      w.runId,
      teamId,
      action,
      c.chatEpoch ?? 0,
    ]);
  const result = await db().eval<unknown[], string>(
    AUTHORITY +
      `
local prior=redis.call('GET',KEYS[5]);if prior then if prior~=ARGV[6] then return 'request' end;return 'ok' end
if not w.hubTeams or not w.hubTeams[ARGV[2]] or not w.hubTeams[ARGV[2]].enabled then return 'disabled' end
local old=redis.call('HGET',KEYS[6],ARGV[2]);local turn=old and cjson.decode(old) or {teamId=ARGV[2],teamName=w.hubTeams[ARGV[2]].teamName,state='waiting',requestedAt=tonumber(ARGV[5]),startedAt=cjson.null}
if ARGV[4]=='release' or ARGV[4]=='cancel' then redis.call('HDEL',KEYS[6],ARGV[2]) else
 if ARGV[4]=='start' then turn.state='using';if turn.startedAt==cjson.null then turn.startedAt=tonumber(ARGV[5]) end end
 redis.call('HSET',KEYS[6],ARGV[2],cjson.encode(turn));redis.call('EXPIRE',KEYS[6],2592000)
end
redis.call('SET',KEYS[5],ARGV[6],'EX',86400);return 'ok'`,
    [
      key(`gpu:workspace:${w.id}`),
      roundKey(c),
      key("teams"),
      registrationKey(c),
      key(`gpu:hub:turn-op:${w.id}:${requestId}`),
      hubTurnKey(w.id, w.runId, c.chatEpoch ?? 0),
    ],
    [w.runId, teamId, user.id, action, now, signature, c.chatEpoch ?? 0],
  );
  writeError(result);
  return { ok: true };
}
