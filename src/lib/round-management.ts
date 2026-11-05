import { z } from "zod";
import { ApiError } from "./api-error";
import { db, key, serverNow } from "./db";
import { namespace, usingPostgres, sqlTransaction, sqlNow, bumpRevision } from "./sql";
import { readRound, readRoundIds, readRounds } from "./entity-repository";
import { putSqlRound, archiveSqlRun } from "./sql-rounds";
import { roundVisible } from "./round-visibility";
import type { Contest } from "./types";

const version = { runId: z.string().uuid(), revision: z.number().int().nonnegative() };
export const roundManagementSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), ...version, title: z.string().trim().min(3).max(100) }),
  z.object({ action: z.literal("delete"), ...version, confirmTitle: z.string().min(1).max(100) }),
  z.object({ action: z.literal("move"), direction: z.enum(["up", "down"]),
    expectedOrder: z.array(z.string().uuid()).min(1).max(1000) }),
]);
export type RoundManagement = z.infer<typeof roundManagementSchema>;
const changed = () => new ApiError("Danh sách hoặc vòng luyện vừa thay đổi. Hãy tải lại rồi thử lại.", 409);

export function moveRoundOrder(ids: string[], id: string, direction: "up" | "down") {
  const next = [...ids], from = next.indexOf(id), to = from + (direction === "up" ? -1 : 1);
  if (from < 0) throw new ApiError("Không tìm thấy vòng luyện.", 404);
  if (to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
export function updateRound(c: Contest, value: Exclude<RoundManagement, { action: "move" }>, now: number): Contest {
  if (!roundVisible(c, true)) throw new ApiError("Không tìm thấy vòng luyện.", 404);
  if (c.id !== value.runId || (c.revision ?? 0) !== value.revision) throw changed();
  if (value.action === "delete" && value.confirmTitle !== c.title) throw changed();
  return { ...c, revision: (c.revision ?? 0) + 1,
    ...(value.action === "rename" ? { title: value.title } : {
      deletedAt: now, hidden: true, forcedEndAt: now, chatEpoch: (c.chatEpoch ?? 0) + 1,
    }),
  };
}

export async function manageRound(id: string, raw: RoundManagement) {
  const value = roundManagementSchema.parse(raw);
  if (usingPostgres()) return sqlTransaction(async client => {
    const c = await readRound(id);
    if (!c || !roundVisible(c, true)) throw new ApiError("Không tìm thấy vòng luyện.", 404);
    if (value.action === "move") {
      const rows = await readRounds(await readRoundIds());
      const ids = rows.filter(c => roundVisible(c, true)).map(c => c!.roundId!);
      if (JSON.stringify(ids) !== JSON.stringify(value.expectedOrder)) throw changed();
      const next = moveRoundOrder(ids, id, value.direction);
      for (let i = 0; i < next.length; i++)
        await client.query("update arena.rounds set catalog_score=$3 where ns=$1 and id=$2", [namespace(), next[i], next.length - i]);
    } else {
      const next = updateRound(c, value, await sqlNow(client));
      await archiveSqlRun(client, c);
      await putSqlRound(client, next);
      if (value.action === "delete")
        await client.query("update arena.rounds set catalog_score=null where ns=$1 and id=$2", [namespace(), id]);
    }
    await bumpRevision(client);
  }, true);
  if (value.action === "move") {
    const result = await db().eval<unknown[], number>(`
      local ids=redis.call('ZREVRANGE',KEYS[1],0,-1);local active={};
      for _,id in ipairs(ids) do local raw=redis.call('GET',ARGV[1]..id);if raw then
        local c=cjson.decode(raw);if not c.deletedAt or c.deletedAt==cjson.null then table.insert(active,id) end end end
      local expected=cjson.decode(ARGV[2]);if #active~=#expected then return 0 end
      for i,id in ipairs(active) do if id~=expected[i] then return 0 end end
      local next=cjson.decode(ARGV[3]);for i,id in ipairs(next) do redis.call('ZADD',KEYS[1],#next-i+1,id) end;return 1`,
      [key("rounds")], [key("round:"), JSON.stringify(value.expectedOrder),
        JSON.stringify(moveRoundOrder(value.expectedOrder, id, value.direction))]);
    if (!result) throw changed();
    return;
  }
  const c = await readRound(id);
  if (!c) throw new ApiError("Không tìm thấy vòng luyện.", 404);
  const next = updateRound(c, value, await serverNow());
  const ok = await db().eval<unknown[], number>(`
    if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
    redis.call('SET',KEYS[3],ARGV[1]);redis.call('SET',KEYS[1],ARGV[2]);
    if ARGV[3]=='delete' then redis.call('ZREM',KEYS[2],ARGV[4]) end;return 1`,
    [key(`round:${id}`), key("rounds"), key(`runs:${c.id}`)],
    [JSON.stringify(c), JSON.stringify(next), value.action, id]);
  if (!ok) throw changed();
}
