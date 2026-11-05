import { db, key } from "./db";
import { namespace, query, usingPostgres } from "./sql";
import { ApiError } from "./api-error";
import { getChatGroup } from "./chat-groups";
import { getWorkspace } from "./workspaces";
import { getContest } from "./rounds";
import { readTeam } from "./entity-repository";
import { roundVisible } from "./round-visibility";
import { readQueuedChat } from "./chat-queue";
import { syncRuntimeHistory } from "./runtime-authority";
import { conversationRef, parseConversationRef, contestantSession, chatPolicyView } from "./chat-conversation";
import type { ChatSession } from "./workspace-domain";
import type { SafeUser } from "./types";

async function historyContext(user: SafeUser, id?: string, groupId?: string) {
  if (!!id === !!groupId) throw new ApiError("Chọn một Chatbot.");
  let target: string, roundId: string, scope: "team" | "all", teamId: string | null;
  if (groupId) {
    const g = await getChatGroup(groupId);
    ({ roundId, scope, teamId } = g); target = `group:${g.id}`;
  } else {
    const w = await getWorkspace(id!);
    if (w.chatGroupId) return historyContext(user, undefined, w.chatGroupId);
    roundId = w.roundId; scope = w.scope ?? "team"; teamId = w.teamId; target = `workspace:${w.id}`;
  }
  const c = await getContest(roundId);
  if (!roundVisible(c, user.admin)) throw new ApiError("Không tìm thấy vòng luyện.", 404);
  let teamName = "Phiên của quản trị viên";
  if (!user.admin) {
    const team = user.teamId ? await readTeam(user.teamId) : null;
    if (!team?.members.includes(user.id) || (scope === "team" && team.id !== teamId))
      throw new ApiError("Bạn không thuộc đội được xem lịch sử này.", 403);
    teamName = team.name;
  }
  return { c, roundId, target, audience: user.admin ? `admin-${user.id}` : `team-${user.teamId}`, teamName };
}
type Row = { kind: string; id: string; payload: ChatSession; observed_at: string | number };
const meta = (r: Row) => r.payload.conversation;
function historyItem(r: Row, runId: string, target: string) {
  const m = meta(r)!;
  return { id: conversationRef(r.kind, r.id), sessionId: m.sessionId, title: m.title,
    createdAt: m.createdAt, updatedAt: m.updatedAt, runId: m.runId,
    current: m.runId === runId && m.target === target };
}
export async function chatHistory(user: SafeUser, id?: string, groupId?: string, cursor?: string) {
  const ctx = await historyContext(user, id, groupId);
  let before: [number, string, string] | null = null;
  if (cursor) {
    try {
      const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Array.isArray(value) || value.length !== 3 || !Number.isFinite(value[0]) || typeof value[1] !== "string" || typeof value[2] !== "string") throw new Error();
      before = value as [number, string, string];
    } catch { throw new ApiError("Mốc lịch sử không hợp lệ."); }
  }
  let rows: Row[];
  if (usingPostgres()) {
    await syncRuntimeHistory();
    rows = await query(`select kind,id,payload,observed_at from arena.runtime_history
      where ns=$1 and kind in ('chat-session','chat-group-session') and round_id=$2
      and payload->'conversation'->>'audience'=$3
      and ($4::bigint is null or (observed_at,id,kind)<($4::bigint,$5::text,$6::text))
      order by observed_at desc,id desc,kind desc limit 51`,
      [namespace(),ctx.roundId,ctx.audience,before?.[0]??null,before?.[1]??null,before?.[2]??null]) as Row[];
  } else {
    const keys = await db().smembers<string[]>(key(`gpu:conversations:${ctx.roundId}:${ctx.audience}`));
    rows = [];
    for (const k of keys) {
      const payload = await db().get<ChatSession>(k);
      const prefix = key("gpu:chat-group:");
      if (!payload?.conversation) continue;
      rows.push({ kind:k.startsWith(prefix)?"chat-group-session":"chat-session",id:k.slice(k.startsWith(prefix)?prefix.length:key("gpu:chat:").length),payload,observed_at:payload.conversation.updatedAt });
    }
    rows.sort((a,b)=>Number(b.observed_at)-Number(a.observed_at)||b.id.localeCompare(a.id)||b.kind.localeCompare(a.kind));
    if (before) rows=rows.filter(r=>Number(r.observed_at)<before![0]||(Number(r.observed_at)===before![0]&&(r.id<before![1]||(r.id===before![1]&&r.kind<before![2]))));
    rows=rows.slice(0,51);
  }
  const page = rows.slice(0,50), last = page.at(-1);
  return { items: page.filter(r=>meta(r)).map(r=>historyItem(r,ctx.c.id,ctx.target)),
    nextCursor: rows.length>50 && last ? Buffer.from(JSON.stringify([Number(last.observed_at),last.id,last.kind])).toString("base64url") : null,
    roundTitle:ctx.c.title,runId:ctx.c.id,admin:user.admin };
}
export async function readConversation(user: SafeUser, ref: string, id?: string, groupId?: string) {
  const ctx = await historyContext(user,id,groupId), location = parseConversationRef(ref);
  if (!location) throw new ApiError("Không tìm thấy cuộc trò chuyện.",404);
  let row: Row | undefined;
  if (usingPostgres()) {
    await syncRuntimeHistory();
    row = (await query(`select kind,id,payload,observed_at from arena.runtime_history where ns=$1 and kind=$2 and id=$3
      and round_id=$4 and payload->'conversation'->>'audience'=$5`,[namespace(),...location,ctx.roundId,ctx.audience]))[0] as Row | undefined;
  } else {
    const k=key(`${location[0]==="chat-group-session"?"gpu:chat-group:":"gpu:chat:"}${location[1]}`),payload=await db().get<ChatSession>(k);
    if(payload?.conversation?.roundId===ctx.roundId&&payload.conversation.audience===ctx.audience)row={kind:location[0],id:location[1],payload,observed_at:0};
  }
  const m=row?.payload.conversation;
  if (!row || !m) throw new ApiError("Không tìm thấy cuộc trò chuyện.",404);
  if(m.runId===ctx.c.id&&m.target===ctx.target) {
    try {
      const live=await readQueuedChat(user,id,m.sessionId,groupId);
      return {...live,readOnly:!live.policyOpen,conversationId:ref,sessionId:m.sessionId};
    }
    catch(e) { if(!(e instanceof ApiError)||![403,404,409].includes(e.status))throw e; }
  }
  const policy=m.policy??{sessionTokenLimit:Math.max(2000,row.payload.inputTokens+row.payload.outputTokens),inputTokenLimit:1800,outputTokenLimit:1024};
  return {admin:user.admin,readOnly:true,provider:undefined,model:"Trợ lý AI",tokenAccounting:undefined,
    session:user.admin?{...row.payload,pending:undefined}:contestantSession({...row.payload,pending:undefined}),template:chatPolicyView(policy),
    contextWindowTokens:0,enabled:false,policyOpen:false,runId:m.runId,serverNow:Date.now(),
    teamName:ctx.teamName,roundTitle:ctx.c.title,statusMessage:"Cuộc trò chuyện đã lưu · Chỉ đọc",conversationId:ref,sessionId:m.sessionId};
}
