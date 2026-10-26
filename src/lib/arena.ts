import { randomUUID, randomBytes, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { db, key, serverNow, storage } from "./db";
import { ApiError } from "./auth";
import { phaseOf, rankTeams, visibleSubmission } from "./domain";
import { judgeCV, judgeQA } from "./judge";
import type {
  Contest,
  ContestPackage,
  Team,
  Submission,
  SafeUser,
  TaskId,
  Split,
  CVImage,
  QAItem,
} from "./types";
export async function getContest() {
  const c = await db().get<Contest>(key("contest"));
  if (!c) throw new ApiError("Chưa khởi tạo buổi thi. Chạy npm run seed.", 503);
  return c;
}
export async function getPackage() {
  return db().get<ContestPackage>(key("package"));
}
export async function getSubmissions(runId: string) {
  const result = await db().hgetall<Record<string, Submission>>(
    key(`submissions:${runId}`),
  );
  return Object.values(result ?? {});
}
export async function snapshot(user: SafeUser) {
  const contest = await getContest();
  const [pkg, now, teams, submissionsRaw, invites] = await Promise.all([
    getPackage(),
    serverNow(),
    db().hgetall<Record<string, Team>>(key("teams")),
    getSubmissions(contest.id),
    db().smembers<string[]>(key(`invites:${user.id}`)),
  ]);
  for (const t of Object.values(teams ?? {}))
    if (!Array.isArray(t.members)) t.members = [];
  const phase = phaseOf(contest, now),
    team = user.teamId ? (teams?.[user.teamId] ?? null) : null;
  const selections =
    (await db().hgetall<Record<string, string>>(
      key(`selections:${contest.id}`),
    )) ?? {};
  const reveal = user.admin || phase === "ended";
  return {
    user,
    contest,
    phase,
    serverNow: now,
    ready: !!pkg,
    packageVersion: pkg?.version,
    assets:
      pkg?.assets.filter(
        (a) =>
          user.admin ||
          (["public", "private", "ended"].includes(phase) &&
            a.phase === "public") ||
          (["private", "ended"].includes(phase) && a.phase === "private"),
      ) ?? [],
    team: team
      ? {
          ...team,
          members: await Promise.all(
            team.members.map(async (id) => {
              const u = await db().get<{ name: string; username: string }>(
                key(`user:${id}`),
              );
              return {
                id,
                name: u?.name ?? "Tài khoản đã xóa",
                username: u?.username ?? "",
              };
            }),
          ),
        }
      : null,
    invites: (invites ?? [])
      .map((id) => teams?.[id])
      .filter((t): t is Team => !!t)
      .map((t) => ({ id: t.id, name: t.name })),
    submissions: submissionsRaw
      .filter((s) => user.admin || s.teamId === user.teamId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => visibleSubmission(s, reveal)),
    selections,
    leaderboard: {
      public: rankTeams(
        Object.values(teams ?? {}),
        submissionsRaw,
        selections,
        "public",
      ),
      private: reveal
        ? rankTeams(
            Object.values(teams ?? {}),
            submissionsRaw,
            selections,
            "private",
          )
        : null,
    },
    announcements: await db().lrange<{
      id: string;
      text: string;
      createdAt: number;
    }>(key(`announcements:${contest.id}`), 0, 19),
    teams: user.admin
      ? Object.values(teams ?? {}).map((t) => ({
          id: t.id,
          name: t.name,
          members: t.members.length,
        }))
      : undefined,
  };
}
export const TEAM_SCRIPT = `
local user=cjson.decode(redis.call('GET',KEYS[1])); local action=ARGV[1]; local teamId=ARGV[2];
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
 local team=cjson.decode(redis.call('HGET',KEYS[2],user.teamId)); local members={}; for _,id in ipairs(team.members) do if id~=user.id then table.insert(members,id) end end
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
export const SUBMIT_SCRIPT = `
local cached=redis.call('GET',KEYS[4]); if cached then return cached end
local c=cjson.decode(redis.call('GET',KEYS[1])); if c.id~=ARGV[1] then return 'run' end
local tm=redis.call('TIME'); local now=tonumber(tm[1])*1000+math.floor(tonumber(tm[2])/1000);
local phase='closed'; if c.startAt~=cjson.null and now>=c.startAt then if now<c.startAt+c.publicSeconds*1000 then phase='public' elseif now<c.startAt+(c.publicSeconds+c.privateSeconds)*1000 then phase='private' end end
if c.forcedEndAt~=cjson.null and now>=c.forcedEndAt then phase='closed' end
if phase~=ARGV[2] then return 'closed' end
local u=cjson.decode(redis.call('GET',KEYS[6])); if u.teamId~=ARGV[4] then return 'team' end
local limit=c.publicLimit; if phase=='private' then limit=c.privateLimit end
local count=tonumber(redis.call('GET',KEYS[2]) or '0'); if count>=limit then return 'quota' end
local submission=cjson.decode(ARGV[3]); submission.createdAt=now;
redis.call('INCR',KEYS[2]); redis.call('HSET',KEYS[3],submission.id,cjson.encode(submission)); redis.call('SET',KEYS[4],submission.id,'EX',86400);
if phase=='private' then redis.call('HSET',KEYS[5],submission.teamId..':'..submission.task,submission.id) end
return submission.id;`;
export async function submit(
  user: SafeUser,
  task: TaskId,
  split: Split,
  file: File,
  note: string,
  nonce: string,
) {
  if (user.admin)
    throw new ApiError(
      "Admin xem đáp án nên không tham gia bảng xếp hạng. Hãy dùng tài khoản thí sinh.",
      403,
    );
  if (!user.teamId)
    throw new ApiError("Hãy tạo hoặc tham gia đội trước khi nộp.");
  const [contest, pkg, now] = await Promise.all([
    getContest(),
    getPackage(),
    serverNow(),
  ]);
  if (phaseOf(contest, now) !== split)
    throw new ApiError("Giai đoạn này chưa mở hoặc đã khóa nộp.", 409);
  if (!pkg) throw new ApiError("Chưa có bộ chấm.", 503);
  const idempotency = key(
    `request:${contest.id}:${user.teamId}:${task}:${split}:${nonce}`,
  );
  const old = await db().get<string>(idempotency);
  if (old) return { id: old };
  const csvBytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(csvBytes);
  } catch {
    throw new ApiError("CSV phải được lưu bằng mã hóa UTF-8.", 422);
  }
  const data = await new Response(
    (await storage().get(pkg.judges[task][split])).body,
  ).arrayBuffer();
  const truth = JSON.parse(gunzipSync(Buffer.from(data)).toString("utf8"));
  const result =
    task === "1"
      ? judgeCV(text, truth as CVImage[])
      : judgeQA(text, truth as QAItem[]);
  const id = randomUUID(),
    path = `submissions/${contest.id}/${user.teamId}/${id}.csv`;
  await storage().put(path, csvBytes, {
    contentType: "text/csv; charset=utf-8",
    cache: "no-store",
  });
  const submission: Submission = {
    id,
    runId: contest.id,
    teamId: user.teamId,
    userId: user.id,
    task,
    split,
    filename: file.name.slice(0, 120),
    createdAt: now,
    score: result.score,
    secondary: result.secondary,
    bytes: file.size,
    sha256: createHash("sha256").update(csvBytes).digest("hex"),
    path,
    note,
  };
  const accepted = await db().eval<unknown[], string>(
    SUBMIT_SCRIPT,
    [
      key("contest"),
      key(`quota:${contest.id}:${user.teamId}:${task}:${split}`),
      key(`submissions:${contest.id}`),
      idempotency,
      key(`selections:${contest.id}`),
      key(`user:${user.id}`),
    ],
    [contest.id, split, JSON.stringify(submission), user.teamId],
  );
  if (accepted !== id)
    await storage()
      .del(path)
      .catch(() => {});
  if (["run", "closed", "quota", "team"].includes(accepted))
    throw new ApiError(
      (
        {
          run: "Buổi thi đã thay đổi.",
          closed: "Đã hết thời gian nhận bài ở giai đoạn này.",
          quota: "Đội đã dùng hết lượt nộp cho tác vụ này.",
          team: "Bạn đã đổi đội trong lúc chấm. Hãy nộp lại.",
        } as Record<string, string>
      )[accepted],
      409,
    );
  return { id: accepted };
}
export async function selectFinal(user: SafeUser, id: string) {
  const c = await getContest(),
    now = await serverNow();
  const s = await db().hget<Submission>(key(`submissions:${c.id}`), id);
  if (!s || s.teamId !== user.teamId || s.split !== "private")
    throw new ApiError("Không tìm thấy bản nộp private của đội.", 404);
  // Selection and deadline check happen in the same Redis operation.
  const result = await db().eval<unknown[], string>(
    `local c=cjson.decode(redis.call('GET',KEYS[1]));local t=redis.call('TIME');local now=tonumber(t[1])*1000+tonumber(t[2])/1000;local u=cjson.decode(redis.call('GET',KEYS[3]));if c.id~=ARGV[1] or c.startAt==cjson.null or now<c.startAt+c.publicSeconds*1000 or now>=c.startAt+(c.publicSeconds+c.privateSeconds)*1000 or (c.forcedEndAt~=cjson.null and now>=c.forcedEndAt) or u.teamId~=ARGV[4] then return 'closed' end;redis.call('HSET',KEYS[2],ARGV[2],ARGV[3]);return 'ok'`,
    [key("contest"), key(`selections:${c.id}`), key(`user:${user.id}`)],
    [c.id, `${s.teamId}:${s.task}`, s.id, s.teamId],
  );
  if (result !== "ok")
    throw new ApiError("Chỉ được chọn bản cuối trong giờ private.", 409);
  void now;
}
export async function control(
  action: string,
  values: Partial<Contest> & {
    action?: string;
    scheduledAt?: string;
    text?: string;
  },
) {
  const c = await getContest(),
    now = await serverNow(),
    phase = phaseOf(c, now);
  if (action === "announce") {
    await db().lpush(key(`announcements:${c.id}`), {
      id: randomUUID(),
      text: values.text,
      createdAt: now,
    });
    return;
  }
  let updated: Contest = { ...c };
  if (action === "configure") {
    if (!["waiting", "scheduled"].includes(phase))
      throw new ApiError("Chỉ sửa cấu hình trước giờ thi.");
    updated = {
      ...c,
      title: values.title!,
      publicSeconds: values.publicSeconds!,
      privateSeconds: values.privateSeconds!,
      publicLimit: values.publicLimit!,
      privateLimit: values.privateLimit!,
    };
  } else if (action === "start" || action === "schedule") {
    if (!["waiting", "scheduled"].includes(phase))
      throw new ApiError("Buổi thi đã bắt đầu.");
    if (!(await getPackage()))
      throw new ApiError("Cần nạp đề và bộ chấm trước.");
    const startAt = action === "start" ? now : Date.parse(values.scheduledAt!);
    if (!Number.isFinite(startAt) || startAt < now - 1000)
      throw new ApiError("Thời gian hẹn phải ở tương lai.");
    updated = { ...c, startAt, forcedEndAt: null };
  } else if (action === "cancel") {
    if (phase !== "scheduled") throw new ApiError("Không có lịch hẹn để hủy.");
    updated.startAt = null;
  } else if (action === "finish") {
    if (!["public", "private"].includes(phase))
      throw new ApiError("Buổi thi chưa diễn ra.");
    updated.forcedEndAt = now;
  } else if (action === "new") {
    if (phase !== "ended")
      throw new ApiError("Kết thúc buổi hiện tại trước khi tạo buổi mới.");
    updated = {
      ...c,
      id: randomUUID(),
      startAt: null,
      forcedEndAt: null,
      createdAt: now,
    };
  } else throw new ApiError("Thao tác không hợp lệ.");
  const result = await db().eval<unknown[], string>(
    `local raw=redis.call('GET',KEYS[1]);if raw~=ARGV[1] then return 'changed' end;redis.call('SET',KEYS[2],raw);redis.call('SET',KEYS[1],ARGV[2]);return 'ok'`,
    [key("contest"), key(`runs:${c.id}`)],
    [JSON.stringify(c), JSON.stringify(updated)],
  );
  if (result !== "ok")
    throw new ApiError("Cấu hình vừa thay đổi. Hãy tải lại trang.", 409);
}
