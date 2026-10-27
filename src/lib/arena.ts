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
import { judgeCV, judgeQA } from "./judge";
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
local tm=redis.call('TIME');local now=tonumber(tm[1])*1000+math.floor(tonumber(tm[2])/1000);
local phase='closed';if c.startAt~=cjson.null and now>=c.startAt then
 local p=c.privateAt;if p==nil or p==cjson.null then if c.unlimited then p=nil else p=c.startAt+c.publicSeconds*1000 end end
 if p==nil or now<p then phase='public' elseif c.unlimited or now<p+c.privateSeconds*1000 then phase='private' end
end
if c.forcedEndAt~=cjson.null and now>=c.forcedEndAt then phase='closed' end
if phase~=ARGV[2] then return 'closed' end
local user=cjson.decode(redis.call('GET',KEYS[5]));if user.teamId~=ARGV[4] then return 'team' end
local reg=redis.call('HGET',KEYS[6],user.id);if not reg or cjson.decode(reg).status~='approved' then return 'registration' end
local limit=c.publicLimit;if phase=='private' then limit=c.privateLimit end
local count=tonumber(redis.call('GET',KEYS[2]) or '0');if count>=limit then return 'quota' end
local s=cjson.decode(ARGV[3]);s.createdAt=now;redis.call('INCR',KEYS[2]);redis.call('HSET',KEYS[3],s.id,cjson.encode(s));redis.call('SET',KEYS[4],s.id,'EX',86400);return s.id;
`;
export async function submit(
  user: SafeUser,
  task: TaskId,
  split: Split,
  file: File,
  note: string,
  nonce: string,
  roundId: string,
) {
  if (user.admin)
    throw new ApiError("Dùng tài khoản thí sinh để nộp bài.", 403);
  if (!user.teamId)
    throw new ApiError("Hãy tạo hoặc tham gia đội trước khi nộp.");
  const contest = await getContest(roundId);
  await requireRegistration(user, contest);
  const [pkg, now] = await Promise.all([getPackage(contest), serverNow()]);
  if (phaseOf(contest, now) !== split)
    throw new ApiError("Chưa mở hoặc đã khóa nhận bài cho tập này.", 409);
  if (!pkg) throw new ApiError("Chưa có bộ chấm.", 503);
  const idempotency = key(
    "request:" +
      contest.id +
      ":" +
      user.teamId +
      ":" +
      task +
      ":" +
      split +
      ":" +
      nonce,
  );
  const old = await db().get<string>(idempotency);
  if (old) return { id: old };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new ApiError("CSV phải được lưu bằng mã hóa UTF-8.", 422);
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
  const id = randomUUID(),
    path =
      "submissions/" +
      (process.env.ARENA_NAMESPACE ?? "arena:v1") +
      "/" +
      contest.id +
      "/" +
      user.teamId +
      "/" +
      id +
      ".csv";
  await storage().put(path, bytes, {
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
    sha256: createHash("sha256").update(bytes).digest("hex"),
    path,
    note,
  };
  const accepted = await db().eval<unknown[], string>(
    SUBMIT_SCRIPT,
    [
      roundKey(contest),
      key("quota:" + contest.id + ":" + user.teamId + ":" + task + ":" + split),
      key("submissions:" + contest.id),
      idempotency,
      key("user:" + user.id),
      registrationKey(contest),
    ],
    [contest.id, split, JSON.stringify(submission), user.teamId],
  );
  if (accepted !== id)
    await storage()
      .del(path)
      .catch(() => {});
  const errors: Record<string, string> = {
    run: "Vòng luyện đã được mở lại. Hãy nộp lại.",
    closed: "Đã hết thời gian nhận bài cho tập này.",
    team: "Bạn đã đổi đội trong lúc chấm. Hãy nộp lại.",
    quota: "Đội đã dùng hết lượt nộp.",
    registration: "Đăng ký tham gia của bạn không còn được duyệt.",
  };
  if (errors[accepted]) throw new ApiError(errors[accepted], 409);
  return { id: accepted };
}
