import { handleAuth, changeExternalPassword } from "@/lib/auth-handlers";
import { authOptions } from "@/lib/supabase-auth";
import { roundVisible } from "@/lib/round-visibility";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loginName } from "@/lib/auth-input";
import { db, key, serverNow, storage } from "@/lib/db";
import {
  ApiError,
  checkPassword,
  getUser,
  hashPassword,
  rateLimit,
  requireAdmin,
  requireUser,
  sameOrigin,
} from "@/lib/auth";
import {
  control,
  getContest,
  getPackage,
  snapshot,
  submit,
  teamAction,
} from "@/lib/arena";
import {
  createRound,
  registerRound,
  requireRegistration,
  reviewRegistration,
} from "@/lib/rounds";
import { taskStatements } from "@/lib/statements";
import { canRead } from "@/lib/domain";
import { guardedRoundActions, roundControlSchema } from "@/lib/round-control";
import { SubmissionError } from "@/lib/judge";
import type { Submission } from "@/lib/types";
import { readSubmissionFile } from "@/lib/submission-storage";
import { adminRoster, deleteRosterEntry } from "@/lib/admin-roster";
import { usingPostgres } from "@/lib/sql";
import { readUser,readUserId,readSubmission,changeSqlPassword } from "@/lib/entity-repository";
import { assertWritesAllowed } from "@/lib/write-control";
import { manageRound, roundManagementSchema } from "@/lib/round-management";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
async function body(req: Request, max = 16000) {
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError("Thiếu nội dung.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new ApiError("Nội dung quá lớn.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function payload(req: Request) {
  try {
    return JSON.parse((await body(req)).toString("utf8"));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("JSON không hợp lệ.");
  }
}
async function handle(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const route = (await context.params).path.join("/");
    if(req.method==="POST"&&!["auth/login","auth/logout"].includes(route)) await assertWritesAllowed();
    const selectedRound = () =>
      z.string().uuid().parse(new URL(req.url).searchParams.get("round"));
    if (req.method === "POST") sameOrigin(req);
    if (route.startsWith("auth/") && req.method === "POST")
      return await handleAuth(req, route, route === "auth/logout" ? {} : await payload(req));
    if (route === "auth/options" && req.method === "GET") return json(authOptions());
    if (route === "me" && req.method === "GET")
      return json({ user: await getUser() });
    if (route === "arena" && req.method === "GET")
      return json(await snapshot(await getUser(), new URL(req.url).searchParams.get("round") ?? undefined));
    if (route === "statement" && req.method === "GET") {
      const viewer = await getUser();
      const contest = await getContest(selectedRound());
      if (!roundVisible(contest, !!viewer?.admin)) throw new ApiError("Không tìm thấy vòng luyện.",404);
      const [pkg, now] = await Promise.all([getPackage(contest), serverNow()]);
      if (!canRead(contest, now, "statement", !!viewer?.admin))
        throw new ApiError("Đề chỉ mở khi buổi thi bắt đầu.", 403);
      if (!pkg) throw new ApiError("Chưa nạp đề.", 404);
      return json({ tasks: taskStatements(pkg) });
    }
    const user = await requireUser();
    if (route === "admin/roster") {
      await requireAdmin();
      if (req.method === "GET") return json(await adminRoster(user));
      const value = z.object({ kind: z.enum(["team", "contestant"]), id: z.string().uuid() }).parse(await payload(req));
      await rateLimit(`admin:delete:${user.id}`, 20, 60);
      return json(await deleteRosterEntry(user, value.kind, value.id));
    }
    if (route === "download" && req.method === "GET") {
      const resource = new URL(req.url).searchParams.get("asset");
      const contest = await getContest(selectedRound());
      await requireRegistration(user, contest);
      const [pkg, now] = await Promise.all([getPackage(contest), serverNow()]);
      const asset = pkg?.assets.find((a) => a.key === resource);
      if (
        !asset ||
        (!user.admin &&
          (asset.name.endsWith(".md") ||
            asset.name === "Bo_de_mo_phong_OlpAI_2026.pdf"))
      )
        throw new ApiError("Không tìm thấy tệp.", 404);
      if (!canRead(contest, now, asset.phase, user.admin))
        throw new ApiError("Tệp chưa được phát.", 403);
      await rateLimit(`download:${user.id}`, 20, 60);
      if (new URL(req.url).searchParams.get("source") === "drive") {
        if (
          !asset.driveUrl ||
          new URL(asset.driveUrl).hostname !== "drive.google.com"
        )
          throw new ApiError("Liên kết Drive chưa được cập nhật.", 404);
        return NextResponse.redirect(asset.driveUrl, {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      const result = await storage().signedReadUrl(asset.key, {
        expiresIn: "1m",
        downloadAs: asset.name,
      });
      return NextResponse.redirect(result.url, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (route === "submission/download" && req.method === "GET") {
      const c = await getContest(selectedRound());
      await requireRegistration(user, c);
      const id = new URL(req.url).searchParams.get("id");
      const s = id
        ? await readSubmission(c.id,id)
        : null;
      if (!s || !s.path || (!user.admin && s.teamId !== user.teamId))
        throw new ApiError("Không tìm thấy bản nộp.", 404);
      if (s.fileStorage === "redis" || s.fileStorage === "postgres") {
        const bytes = await readSubmissionFile(s);
        const filename = encodeURIComponent(s.filename).replace(
          /['()*]/g,
          (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
        );
        return new Response(new Uint8Array(bytes), {
          headers: {
            "Content-Type": s.filename.toLowerCase().endsWith(".zip") ? "application/zip" : "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="submission.${s.filename.toLowerCase().endsWith(".zip") ? "zip" : "csv"}"; filename*=UTF-8''${filename}`,
            "Cache-Control": "private, no-store",
          },
        });
      }
      const result = await storage().signedReadUrl(s.path, {
        expiresIn: "1m",
        downloadAs: s.filename,
      });
      return NextResponse.redirect(result.url, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (req.method !== "POST")
      throw new ApiError("Không tìm thấy chức năng.", 404);
    if (route === "team") {
      if (user.admin)
        throw new ApiError("Tài khoản quản trị không tham gia đội.", 403);
      await rateLimit(`team:${user.id}`, 30, 60);
      const value = z
        .discriminatedUnion("action", [
          z.object({
            action: z.literal("create"),
            name: z.string().trim().min(2).max(50),
          }),
          z.object({action:z.literal("rename"),name:z.string().trim().min(2).max(50).refine(v=>!/[\p{Cc}\p{Cf}]/u.test(v),"Tên đội không hợp lệ.")}),
          z.object({
            action: z.literal("join"),
            code: z.string().max(40).optional(),
            teamId: z.string().uuid().optional(),
          }),
          z.object({ action: z.literal("leave") }),
          z.object({
            action: z.literal("invite"),
            username: loginName,
          }),
          z.object({ action: z.literal("decline"), teamId: z.string().uuid() }),
        ])
        .parse(await payload(req));
      await teamAction(user, value.action, value);
      return json({ ok: true });
    }
    if (route === "password") {
      if(user.loginProvider==="google")throw new ApiError("Tài khoản đang đăng nhập bằng Google không đổi mật khẩu tại đây.",403);
      const value = z
        .object({
          current: z.string().max(128),
          password: z.string().min(10).max(128),
        })
        .parse(await payload(req));
      await rateLimit(`password:${user.id}`, 5, 900);
      const record = await readUser(user.id);
      if (record?.password === "external:supabase") {
        await changeExternalPassword(user.id,record.username,value.current,value.password);
        return json({ok:true});
      }
      if (!record || !(await checkPassword(value.current, record.password)))
        throw new ApiError("Mật khẩu hiện tại không đúng.");
      const hash = await hashPassword(value.password);
      if(usingPostgres()) await changeSqlPassword(user.id,record.password,hash);
      else await db().eval(
        `local u=cjson.decode(redis.call('GET',KEYS[1]));u.password=ARGV[1];redis.call('SET',KEYS[1],cjson.encode(u));return 1`,
        [key(`user:${user.id}`)],
        [hash],
      );
      return json({ ok: true });
    }
    if (route === "submit") {
      await rateLimit(`submit:${user.id}`, 10, 60);
      const raw = await body(req, 4_200_000);
      const form = await new Request(req.url, {
        method: "POST",
        headers: { "content-type": req.headers.get("content-type") ?? "" },
        body: raw,
      }).formData();
      const file = form.get("file"),
        task = z.enum(["1", "2", "3"]).parse(form.get("task")),
        split = z.enum(["public", "private"]).parse(form.get("split")),
        nonce = z.string().uuid().parse(form.get("nonce"));
      if (!(file instanceof File)) throw new ApiError("Hãy chọn tệp nộp bài.");
      const result = await submit(
        user,
        task,
        split,
        file,
        nonce,
        selectedRound(),
      );
      return json(result, result.status === "invalid" ? 422 : 200);
    }
    if (route === "round/register") {
      await rateLimit("enroll:" + user.id, 20, 60);
      await registerRound(user, selectedRound());
      return json({ ok: true });
    }
    if (route === "admin/round/manage" && req.method === "POST") {
      await requireAdmin();
      await rateLimit(`admin:round-manage:${user.id}`, 60, 60);
      await manageRound(selectedRound(), roundManagementSchema.parse(await payload(req)));
      return json({ ok: true });
    }
    if (route === "admin/round/create") {
      await requireAdmin();
      const v = z
        .object({
          title: z.string().trim().min(3).max(100),
          packageId: z.string().min(1).max(100),
        })
        .parse(await payload(req));
      return json(await createRound(v.title, v.packageId));
    }
    if (route === "admin/registration") {
      await requireAdmin();
      const v = z
        .object({
          userId: z.string().uuid(),
          status: z.enum(["approved", "rejected"]),
        })
        .parse(await payload(req));
      await reviewRegistration(selectedRound(), v.userId, v.status);
      return json({ ok: true });
    }
    if (route === "admin/control") {
      await requireAdmin();
      await rateLimit(`admin:${user.id}`, 30, 60);
      const rawControl = await payload(req);
      if (
        rawControl &&
        typeof rawControl === "object" &&
        guardedRoundActions.includes(
          (rawControl as { action?: string }).action ?? "",
        )
      ) {
        const value = roundControlSchema.parse(rawControl);
        await control(value.action, value, selectedRound());
        return json({ ok: true });
      }
      const value = z
        .discriminatedUnion("action", [
          z.object({ action: z.literal("visibility"), hidden: z.boolean() }),
          z.object({
            action: z.literal("configure"),
            title: z.string().trim().min(3).max(100),
            unlimited: z.boolean().optional(),
            autoApprove: z.boolean().optional(),
            publicSeconds: z.number().int().min(30).max(43200),
            privateSeconds: z.number().int().min(30).max(7200),
            publicLimit: z.number().int().min(1).max(1000),
            privateLimit: z.number().int().min(1).max(1000),
          }),
          z.object({
            action: z.literal("approval-mode"),
            autoApprove: z.boolean(),
          }),
          z.object({
            action: z.literal("grant-quota"),
            runId: z.string().uuid(),
            requestId: z.string().uuid(),
            split: z.enum(["public", "private"]),
            amount: z.number().int().min(1).max(100),
          }),
          z.object({
            action: z.literal("schedule"),
            scheduledAt: z.string().datetime(),
          }),
          z.object({
            action: z.literal("reset"),
            keepLeaderboard: z.boolean().optional(),
          }),
          z.object({
            action: z.literal("new"),
            keepLeaderboard: z.boolean().optional(),
          }),
          ...(["start", "cancel", "finish"] as const).map((action) =>
            z.object({ action: z.literal(action) }),
          ),
          z.object({
            action: z.literal("announce"),
            text: z.string().trim().min(1).max(1000),
          }),
        ])
        .parse(rawControl);
      await control(value.action, value, selectedRound());
      return json({ ok: true });
    }
    if (route === "admin/export") {
      await requireAdmin();
      const data = await snapshot(user, selectedRound());
      return json(data);
    }
    throw new ApiError("Không tìm thấy chức năng.", 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        {
          error:
            "Dữ liệu không hợp lệ. Kiểm tra độ dài và định dạng các trường.",
        },
        400,
      );
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    if (e instanceof SubmissionError) return json({ error: e.message }, 422);
    console.error(
      "Arena request failed",
      e instanceof Error ? e.name : "UnknownError",
    );
    return json(
      {
        error:
          "Dịch vụ tạm thời không phản hồi. Hãy thử lại; nếu đã nộp, kiểm tra lịch sử trước.",
      },
      503,
    );
  }
}
export const GET = handle;
export const POST = handle;
