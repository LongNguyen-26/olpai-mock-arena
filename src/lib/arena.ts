import { randomUUID, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { db, key, serverNow, storage } from "./db";
import { ApiError } from "./auth";
import { submissionAccess } from "./domain";
import { ROUND_POLICY_LUA } from "./round-policy-lua";
import {
  getContest,
  getPackage,
  requireRegistration,
  roundKey,
  registrationKey,
} from "./rounds";
import { SubmissionError, judgeCV, judgeQA } from "./judge";
import { judgeArena02 } from "./judge-arena02";
import { judgeDirect } from "./judge-direct";
import { taskStatements } from "./statements";
import {
  storeSubmissionFile,
  deleteSubmissionFile,
} from "./submission-storage";
import type {
  SafeUser,
  TaskId,
  Split,
  CVImage,
  QAItem,
  Submission,
} from "./types";
export {
  getContest,
  getPackage,
  getSubmissions,
  snapshot,
  control,
} from "./rounds";
export { teamAction } from "./teams";
export const SUBMIT_SCRIPT =
  ROUND_POLICY_LUA +
  `
local cached=redis.call('GET',KEYS[4]);if cached then return cached end
local now=arena_now();local c=arena_round(KEYS[1],now);if not c or c.id~=ARGV[1] then return 'run' end
if c.deletedAt and c.deletedAt~=cjson.null then return 'run' end
local rawUser=redis.call('GET',KEYS[5]);if not rawUser then return 'role' end
local user=cjson.decode(rawUser);local admin=redis.call('GET',KEYS[7])==user.id or redis.call('SISMEMBER',KEYS[8],user.id)==1
local s=cjson.decode(ARGV[3]);if s.adminTest and not admin then return 'role' end
if not admin then
 if c.hidden==true then return 'closed' end
 if not arena_submit(c,now,ARGV[2]) then return 'closed' end
 if user.teamId~=ARGV[4] then return 'team' end
 local reg=redis.call('HGET',KEYS[6],user.id);if not reg or cjson.decode(reg).status~='approved' then return 'registration' end
 if s.status~='invalid' then
  local limit=c.publicLimit;if ARGV[2]=='private' then limit=c.privateLimit end
  if tonumber(redis.call('GET',KEYS[2]) or '0')>=limit then return 'quota' end
  redis.call('INCR',KEYS[2])
 end
end
s.createdAt=now;redis.call('HSET',KEYS[3],s.id,cjson.encode(s));redis.call('SET',KEYS[4],s.id,'EX',86400);return s.id
`;
function response(s: Submission) {
  return {
    id: s.id,
    status: s.status ?? "accepted",
    score: s.status === "invalid" ? null : s.score,
    secondary: s.status === "invalid" ? null : s.secondary,
    metric: s.status === "invalid" ? null : s.metric,
    error: s.error,
    adminTest: !!s.adminTest,
  };
}
export async function submit(
  user: SafeUser,
  task: TaskId,
  split: Split,
  file: File,
  nonce: string,
  roundId: string,
) {
  const admin = user.admin,
    actor = admin ? "admin:" + user.id : user.teamId;
  if (!actor) throw new ApiError("Hãy tạo hoặc tham gia đội trước khi nộp.");
  const contest = await getContest(roundId);
  await requireRegistration(user, contest);
  const [pkg, now] = await Promise.all([getPackage(contest), serverNow()]);
  if (!admin && !submissionAccess(contest, now, split).accepting)
    throw new ApiError("Chưa mở hoặc đã khóa nhận bài cho tập này.", 409);
  if (!pkg) throw new ApiError("Chưa có bộ chấm.", 503);
  const judgeKeys = pkg.judges[task];
  if (!judgeKeys || !taskStatements(pkg).some((t) => t.id === task))
    throw new ApiError("Tác vụ không thuộc bộ đề này.", 400);
  const idempotency = key(
    "request:" +
      contest.id +
      ":" +
      actor +
      ":" +
      task +
      ":" +
      split +
      ":" +
      nonce,
  );
  const old = await db().get<string>(idempotency);
  if (old) {
    const previous = await db().hget<Submission>(
      key("submissions:" + contest.id),
      old,
    );
    if (previous) return response(previous);
  }
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(),
    score = 0,
    secondary = 0,
    metric: number | undefined,
    error = "";
  try {
    if (
      !file.name.toLowerCase().endsWith(".csv") ||
      file.size < 1 ||
      file.size > 3_000_000
    )
      throw new SubmissionError("Chọn một CSV UTF-8, tối đa 3 MB.");
    bytes = new Uint8Array(await file.arrayBuffer());
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      throw new SubmissionError("CSV phải được lưu bằng mã hóa UTF-8.");
    }
    const truth = JSON.parse(
      gunzipSync(
        Buffer.from(
          await new Response(
            (await storage().get(judgeKeys[split])).body,
          ).arrayBuffer(),
        ),
      ).toString("utf8"),
    );
    const result = pkg.directJudgeSpecs?.[task]
      ? judgeDirect(text, truth, pkg.directJudgeSpecs[task]!)
      : pkg.judgeSpecs?.[task]
        ? judgeArena02(text, truth, pkg.judgeSpecs[task]!)
        : task === "1"
          ? judgeCV(text, truth as CVImage[])
          : judgeQA(text, truth as QAItem[]);
    score = result.score;
    secondary = result.secondary;
    metric = result.metric;
  } catch (e) {
    if (!(e instanceof SubmissionError)) throw e;
    error = e.message;
  }
  const id = randomUUID(),
    path = bytes.length
      ? "submissions/" +
        (process.env.ARENA_NAMESPACE ?? "arena:v1") +
        "/" +
        contest.id +
        "/" +
        actor +
        "/" +
        id +
        ".csv"
      : "";
  const location = path ? await storeSubmissionFile(path, id, bytes) : { path };
  const record: Submission = {
    id,
    runId: contest.id,
    teamId: actor,
    userId: user.id,
    task,
    split,
    filename: file.name.slice(0, 120),
    createdAt: now,
    score,
    secondary,
    ...(metric === undefined ? {} : { metric }),
    bytes: file.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...location,
    note: "",
    status: error ? "invalid" : "accepted",
    ...(error ? { error } : {}),
    adminTest: admin,
  };
  const accepted = await db().eval<unknown[], string>(
    SUBMIT_SCRIPT,
    [
      roundKey(contest),
      key("quota:" + contest.id + ":" + actor + ":" + task + ":" + split),
      key("submissions:" + contest.id),
      idempotency,
      key("user:" + user.id),
      registrationKey(contest),
      key("admin"),
      key("admins"),
    ],
    [contest.id, split, JSON.stringify(record), actor],
  );
  if (accepted !== id && path)
    await deleteSubmissionFile(location).catch(() => {});
  const errors: Record<string, string> = {
    run: "Vòng luyện đã được mở lại. Hãy nộp lại.",
    closed: "Đã hết thời gian nhận bài cho tập này.",
    team: "Bạn đã đổi đội trong lúc chấm. Hãy nộp lại.",
    quota: "Đội đã dùng hết lượt nộp.",
    registration: "Đăng ký tham gia không còn được duyệt.",
    role: "Quyền tài khoản đã thay đổi.",
  };
  if (errors[accepted]) throw new ApiError(errors[accepted], 409);
  if (accepted !== id) {
    const previous = await db().hget<Submission>(
      key("submissions:" + contest.id),
      accepted,
    );
    if (previous) return response(previous);
  }
  return response(record);
}
