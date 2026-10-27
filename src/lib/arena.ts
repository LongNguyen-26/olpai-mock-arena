import { randomUUID, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { db, key, serverNow, storage } from "./db";
import { ApiError } from "./auth";
import { phaseOf } from "./domain";
import {
  getContest,
  getPackage,
  requireRegistration,
  roundKey,
  registrationKey,
} from "./rounds";
import { SubmissionError, judgeCV, judgeQA } from "./judge";
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
export const SUBMIT_SCRIPT = `
local cached=redis.call('GET',KEYS[4]);if cached then return cached end
local raw=redis.call('GET',KEYS[1]);if not raw then return 'run' end
local c=cjson.decode(raw);if c.id~=ARGV[1] then return 'run' end
local user=cjson.decode(redis.call('GET',KEYS[5]));local admin=redis.call('GET',KEYS[7])==user.id
local tm=redis.call('TIME');local now=tonumber(tm[1])*1000+math.floor(tonumber(tm[2])/1000)
local s=cjson.decode(ARGV[3]);if s.adminTest and not admin then return 'role' end
if not admin then
 local phase='closed';if c.startAt~=cjson.null and now>=c.startAt then
  local p=c.privateAt;if p==nil or p==cjson.null then if c.unlimited then p=nil else p=c.startAt+c.publicSeconds*1000 end end
  if p==nil or now<p then phase='public' elseif c.unlimited or now<p+c.privateSeconds*1000 then phase='private' end
 end
 if c.forcedEndAt~=cjson.null and now>=c.forcedEndAt then phase='closed' end
 if phase~=ARGV[2] then return 'closed' end
 if user.teamId~=ARGV[4] then return 'team' end
 local reg=redis.call('HGET',KEYS[6],user.id);if not reg or cjson.decode(reg).status~='approved' then return 'registration' end
 if s.status~='invalid' then
  local limit=c.publicLimit;if phase=='private' then limit=c.privateLimit end
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
  if (!admin && phaseOf(contest, now) !== split)
    throw new ApiError("Chưa mở hoặc đã khóa nhận bài cho tập này.", 409);
  if (!pkg) throw new ApiError("Chưa có bộ chấm.", 503);
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
            (await storage().get(pkg.judges[task][split])).body,
          ).arrayBuffer(),
        ),
      ).toString("utf8"),
    );
    const result =
      task === "1"
        ? judgeCV(text, truth as CVImage[])
        : judgeQA(text, truth as QAItem[]);
    score = result.score;
    secondary = result.secondary;
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
  if (path)
    await storage().put(path, bytes, {
      contentType: "text/csv; charset=utf-8",
      cache: "no-store",
    });
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
    bytes: file.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    path,
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
    ],
    [contest.id, split, JSON.stringify(record), actor],
  );
  if (accepted !== id && path)
    await storage()
      .del(path)
      .catch(() => {});
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
