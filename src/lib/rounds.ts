import { randomUUID } from "node:crypto";
import { db, key, serverNow } from "./db";
import { ApiError } from "./auth";
import { canRead, phaseOf, rankTeams, visibleSubmission } from "./domain";
import { taskStatements } from "./statements";
import { GRANT_QUOTA_SCRIPT } from "./round-quota";
import { roundVisible } from "./round-visibility";
import type {
  Contest,
  ContestPackage,
  Registration,
  SafeUser,
  Submission,
  Team,
  User,
  TaskId,
} from "./types";
export const roundKey = (c: Contest) =>
  key(c.roundId ? `round:${c.roundId}` : "contest");
export const registrationKey = (c: Contest) =>
  key(`registrations:${c.roundId ?? c.id}`);
export async function getContest(id?: string) {
  const c = await db().get<Contest>(id ? key(`round:${id}`) : key("contest"));
  if (!c || !roundVisible(c, true))
    throw new ApiError("Không tìm thấy vòng luyện.", 404);
  return c;
}
export async function getPackage(c?: Contest) {
  return db().get<ContestPackage>(
    key(c?.packageId ? `package:${c.packageId}` : "package"),
  );
}
export async function getSubmissions(id: string) {
  return Object.values(
    (await db().hgetall<Record<string, Submission>>(
      key(`submissions:${id}`),
    )) ?? {},
  );
}
export async function requireRegistration(user: SafeUser, c: Contest) {
  if (!roundVisible(c, user.admin))
    throw new ApiError("Không tìm thấy vòng luyện.", 404);
  if (user.admin) return;
  const r = await db().hget<Registration>(registrationKey(c), user.id);
  if (r?.status !== "approved")
    throw new ApiError(
      r?.status === "pending"
        ? "Đăng ký của bạn đang chờ duyệt."
        : "Bạn cần đăng ký tham gia vòng luyện này.",
      403,
    );
}
export async function snapshot(user: SafeUser, id?: string) {
  const [ids, now, teamsRaw, inviteIds, adminId] = await Promise.all([
    db().zrange<string[]>(key("rounds"), 0, -1, { rev: true }),
    serverNow(),
    db().hgetall<Record<string, Team>>(key("teams")),
    db().smembers<string[]>(key(`invites:${user.id}`)),
    db().get<string>(key("admin")),
  ]);
  const contests = ids.length
    ? await db().mget<(Contest | null)[]>(...ids.map((x) => key(`round:${x}`)))
    : [];
  const registrations = await Promise.all(
    contests.map((c) =>
      c ? db().hgetall<Record<string, Registration>>(registrationKey(c)) : null,
    ),
  );
  const rounds = contests.flatMap((c, i) =>
    c && roundVisible(c, user.admin)
      ? [
          {
            id: c.roundId ?? c.id,
            title: c.title,
            taskCount: c.taskCount ?? 2,
            phase: phaseOf(c, now),
            startAt: c.startAt,
            privateAt: c.privateAt ?? null,
            forcedEndAt: c.forcedEndAt,
            publicSeconds: c.publicSeconds,
            privateSeconds: c.privateSeconds,
            unlimited: !!c.unlimited,
            autoApprove: c.autoApprove !== false,
            hidden: !!c.hidden,
            registration: registrations[i]?.[user.id] ?? null,
            registrationCount: Object.values(registrations[i] ?? {}).filter(
              (r) => r.userId !== adminId && r.status !== "rejected",
            ).length,
          },
        ]
      : [],
  );
  const teams = teamsRaw ?? {};
  for (const t of Object.values(teams))
    if (!Array.isArray(t.members)) t.members = [];
  const rawTeam = user.teamId ? (teams[user.teamId] ?? null) : null;
  const team = rawTeam
    ? {
        ...rawTeam,
        members: await Promise.all(
          rawTeam.members.map(async (memberId) => {
            const u = await db().get<User>(key(`user:${memberId}`));
            return {
              id: memberId,
              name: u?.name ?? "",
              username: u?.username ?? "",
            };
          }),
        ),
      }
    : null;
  const contest = id ? await getContest(id) : null;
  if (contest && !roundVisible(contest, user.admin))
    throw new ApiError("Không tìm thấy vòng luyện.", 404);
  const registration = contest
    ? await db().hget<Registration>(registrationKey(contest), user.id)
    : null;
  const entered =
    !!contest && (user.admin || registration?.status === "approved");
  const pkg = contest && entered ? await getPackage(contest) : null;
  const definitions = pkg ? taskStatements(pkg) : [];
  const taskIds: TaskId[] = definitions.length
    ? definitions.map((t) => t.id)
    : ["1", "2"];
  const rows = contest && entered ? await getSubmissions(contest.id) : [];
  const phase = contest ? phaseOf(contest, now) : "waiting";
  const canReadStatement =
    !!contest && entered && canRead(contest, now, "statement", user.admin);
  const privateVisible =
    !!contest &&
    entered &&
    (user.admin || ["private", "ended"].includes(phase));
  const roster = contest
    ? Object.values(
        (await db().hgetall<Record<string, Registration>>(
          registrationKey(contest),
        )) ?? {},
      )
    : [];
  const approved = roster.filter((r) => r.status === "approved");
  const participants = approved.filter((r) => r.userId !== adminId);
  const participantIds = new Set(participants.map((r) => r.userId));
  const teamCount = Object.values(teams).filter((t) =>
    t.members.some((id) => participantIds.has(id)),
  ).length;
  return {
    user,
    rounds,
    contest,
    registration,
    entered,
    participantCount: participants.length,
    teamCount,
    phase,
    serverNow: now,
    ready: !!pkg,
    canReadStatement,
    taskIds,
    maxScore: definitions.length
      ? definitions.reduce((sum, t) => sum + (t.maxScore ?? 100), 0)
      : 200,
    tasks:
      canReadStatement && pkg
        ? definitions.map((t) => ({
            id: t.id,
            title: t.title,
            maxScore: t.maxScore ?? 100,
            columns:
              t.columns ??
              (t.id === "1"
                ? ["ImageId", "EncodedPixels"]
                : ["id", "prediction"]),
          }))
        : [],
    assets:
      pkg && contest
        ? pkg.assets.filter(
            (a) =>
              !a.name.endsWith(".md") &&
              a.name !== "Bo_de_mo_phong_OlpAI_2026.pdf" &&
              canRead(contest, now, a.phase, user.admin),
          )
        : [],
    team,
    invites: inviteIds
      .map((i) => teams[i])
      .filter((t): t is Team => !!t)
      .map((t) => ({ id: t.id, name: t.name })),
    submissions: rows
      .filter((s) => user.admin || s.teamId === user.teamId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => visibleSubmission(s)),
    selections: {},
    leaderboard: {
      public: rankTeams(Object.values(teams), rows, {}, "public", taskIds),
      private: privateVisible
        ? rankTeams(Object.values(teams), rows, {}, "private", taskIds)
        : null,
    },
    announcements:
      contest && entered
        ? await db().lrange<{ id: string; text: string; createdAt: number }>(
            key(`announcements:${contest.id}`),
            0,
            19,
          )
        : [],
    packages: user.admin
      ? Object.entries(
          (await db().hgetall<Record<string, string>>(key("packages"))) ?? {},
        ).map(([id, title]) => ({ id, title }))
      : [],
    registrations: await Promise.all(
      (user.admin ? roster : []).map(async (r) => {
        const u = await db().get<User>(key(`user:${r.userId}`));
        return { ...r, name: u?.name ?? "", username: u?.username ?? "" };
      }),
    ),
    teams: user.admin
      ? Object.values(teams).map((t) => ({
          id: t.id,
          name: t.name,
          members: t.members.length,
        }))
      : [],
  };
}
export async function registerRound(user: SafeUser, id: string) {
  const c = await getContest(id);
  if (!roundVisible(c)) throw new ApiError("Không tìm thấy vòng luyện.", 404);
  if (user.admin) throw new ApiError("Tài khoản quản trị không cần đăng ký.");
  const registered = await db().eval<unknown[], number>(
    `local raw=redis.call('GET',KEYS[1]);if not raw then return 0 end;local c=cjson.decode(raw);if c.hidden==true or (c.deletedAt and c.deletedAt~=cjson.null) then return 0 end;local old=redis.call('HGET',KEYS[2],ARGV[1]);if old then local r=cjson.decode(old);if r.status=='approved' or r.status=='pending' then return 1 end end;local r=cjson.decode(ARGV[2]);if c.autoApprove==false then r.status='pending' else r.status='approved' end;redis.call('HSET',KEYS[2],ARGV[1],cjson.encode(r));return 1`,
    [roundKey(c), registrationKey(c)],
    [
      user.id,
      JSON.stringify({
        userId: user.id,
        status: "pending",
        registeredAt: await serverNow(),
      }),
    ],
  );
  if (!registered) throw new ApiError("Không tìm thấy vòng luyện.", 404);
}
export async function reviewRegistration(
  id: string,
  userId: string,
  status: "approved" | "rejected",
) {
  const c = await getContest(id);
  const result = await db().eval<unknown[], number>(
    `local raw=redis.call('HGET',KEYS[1],ARGV[1]);if not raw then return 0 end;local r=cjson.decode(raw);r.status=ARGV[2];redis.call('HSET',KEYS[1],ARGV[1],cjson.encode(r));return 1`,
    [registrationKey(c)],
    [userId, status],
  );
  if (!result) throw new ApiError("Không tìm thấy đăng ký.", 404);
}
export async function createRound(title: string, packageId: string) {
  const pkg = await db().get<ContestPackage>(key(`package:${packageId}`));
  if (!pkg) throw new ApiError("Không tìm thấy bộ đề.");
  const id = randomUUID(),
    now = await serverNow();
  const c: Contest = {
    id: randomUUID(),
    roundId: id,
    packageId,
    title,
    startAt: null,
    privateAt: null,
    forcedEndAt: null,
    unlimited: false,
    autoApprove: true,
    taskCount: taskStatements(pkg).length,
    publicSeconds: 18000,
    privateSeconds: 3600,
    publicLimit: 20,
    privateLimit: 5,
    createdAt: now,
  };
  await db()
    .multi()
    .set(key(`round:${id}`), c)
    .zadd(key("rounds"), { score: now, member: id })
    .exec();
  return { id };
}
export async function control(
  action: string,
  values: Partial<Contest> & {
    action?: string;
    scheduledAt?: string;
    text?: string;
    runId?: string;
    split?: "public" | "private";
    amount?: number;
    requestId?: string;
  },
  id: string,
) {
  const c = await getContest(id),
    now = await serverNow(),
    phase = phaseOf(c, now);
  let next = { ...c };
  if (action === "grant-quota") {
    if (
      values.runId !== c.id ||
      !values.requestId ||
      !["public", "private"].includes(values.split ?? "") ||
      !Number.isInteger(values.amount) ||
      values.amount! < 1 ||
      values.amount! > 100
    )
      throw new ApiError(
        "Yêu cầu tăng quota không hợp lệ hoặc lượt luyện đã thay đổi.",
        409,
      );
    const fingerprint = `${c.id}:${values.split}:${values.amount}`;
    const result = await db().eval<unknown[], string>(
      GRANT_QUOTA_SCRIPT,
      [roundKey(c), key(`quota-grant:${c.id}:${values.requestId}`)],
      [c.id, values.split!, String(values.amount), fingerprint],
    );
    if (result !== "ok")
      throw new ApiError(
        result === "closed"
          ? "Chỉ tăng quota khi vòng luyện đang mở."
          : result === "limit"
            ? "Quota tối đa là 1.000 lượt mỗi tác vụ."
            : "Yêu cầu đã thay đổi hoặc lượt luyện đã được đặt lại. Hãy tải lại.",
        409,
      );
    return;
  }
  if (action === "announce") {
    await db().lpush(key(`announcements:${c.id}`), {
      id: randomUUID(),
      text: values.text,
      createdAt: now,
    });
    return;
  }
  if (action === "visibility") {
    if (typeof values.hidden !== "boolean")
      throw new ApiError("Chọn trạng thái hiển thị.");
    next.hidden = values.hidden;
  } else if (action === "configure") {
    if (!["waiting", "scheduled"].includes(phase))
      throw new ApiError("Chỉ sửa thời lượng và quota trước khi bắt đầu.");
    next = {
      ...c,
      title: values.title!,
      publicSeconds: values.publicSeconds!,
      privateSeconds: values.privateSeconds!,
      publicLimit: values.publicLimit!,
      privateLimit: values.privateLimit!,
      unlimited: values.unlimited ?? false,
      autoApprove: values.autoApprove ?? true,
    };
  } else if (action === "approval-mode") {
    next.autoApprove = values.autoApprove ?? true;
  } else if (action === "start" || action === "schedule") {
    if (!["waiting", "scheduled"].includes(phase))
      throw new ApiError("Vòng luyện đã bắt đầu.");
    if (!(await getPackage(c))) throw new ApiError("Chưa nạp bộ đề.");
    const startAt = action === "start" ? now : Date.parse(values.scheduledAt!);
    if (!Number.isFinite(startAt) || startAt < now)
      throw new ApiError("Giờ hẹn phải ở tương lai.");
    next = { ...c, startAt, privateAt: null, forcedEndAt: null };
  } else if (action === "cancel") {
    if (phase !== "scheduled") throw new ApiError("Không có lịch hẹn.");
    next.startAt = null;
  } else if (action === "open-private") {
    if (phase !== "public")
      throw new ApiError("Chỉ mở private khi vòng luyện đang diễn ra.");
    next.privateAt = now;
  } else if (action === "finish") {
    if (!["public", "private"].includes(phase))
      throw new ApiError("Vòng luyện chưa bắt đầu.");
    next.forcedEndAt = now;
  } else if (action === "reset" || action === "new") {
    next = {
      ...c,
      id: randomUUID(),
      startAt: null,
      privateAt: null,
      forcedEndAt: null,
      createdAt: now,
    };
  } else throw new ApiError("Thao tác không hợp lệ.");
  const ok = await db().eval<unknown[], number>(
    `local raw=redis.call('GET',KEYS[1]);if raw~=ARGV[1] then return 0 end;redis.call('SET',KEYS[2],raw);redis.call('SET',KEYS[1],ARGV[2]);return 1`,
    [roundKey(c), key(`runs:${c.id}`)],
    [JSON.stringify(c), JSON.stringify(next)],
  );
  if (!ok)
    throw new ApiError("Vòng luyện vừa được cập nhật. Hãy tải lại.", 409);
}
