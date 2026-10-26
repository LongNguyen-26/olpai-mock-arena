import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, key, serverNow, storage } from "@/lib/db";
import {
  ApiError,
  checkPassword,
  createSession,
  getUser,
  hashPassword,
  logout,
  rateLimit,
  requireAdmin,
  requireUser,
  sameOrigin,
} from "@/lib/auth";
import {
  control,
  getContest,
  getPackage,
  selectFinal,
  snapshot,
  submit,
  teamAction,
} from "@/lib/arena";
import { canRead } from "@/lib/domain";
import { SubmissionError } from "@/lib/judge";
import type { Submission, User } from "@/lib/types";
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
    if (req.method === "POST") sameOrigin(req);
    if (route === "auth/register" && req.method === "POST") {
      const value = z
        .object({
          username: z.string().regex(/^[a-zA-Z0-9_]{3,24}$/),
          name: z.string().trim().min(2).max(60),
          password: z.string().min(10).max(128),
        })
        .parse(await payload(req));
      await rateLimit(
        `register:${req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
        10,
        3600,
      );
      const user: User = {
        ...value,
        username: value.username.toLowerCase(),
        password: await hashPassword(value.password),
        id: randomUUID(),
        teamId: null,
        createdAt: Date.now(),
      };
      const created = await db().eval<unknown[], number>(
        `if redis.call('EXISTS',KEYS[1])==1 then return 0 end;redis.call('SET',KEYS[1],ARGV[1]);redis.call('SET',KEYS[2],ARGV[2]);return 1`,
        [key(`username:${user.username}`), key(`user:${user.id}`)],
        [user.id, JSON.stringify(user)],
      );
      if (!created) throw new ApiError("Tên đăng nhập đã được sử dụng.", 409);
      await createSession(user.id);
      return json({ ok: true });
    }
    if (route === "auth/login" && req.method === "POST") {
      const value = z
        .object({
          username: z.string().min(1).max(24),
          password: z.string().max(128),
        })
        .parse(await payload(req));
      await rateLimit(
        `login:ip:${req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
        60,
        900,
      );
      await rateLimit(`login:${value.username.toLowerCase()}`, 15, 900);
      const id = await db().get<string>(
        key(`username:${value.username.toLowerCase()}`),
      );
      const user = id ? await db().get<User>(key(`user:${id}`)) : null;
      // Run a password KDF for unknown users as well.
      const valid = await checkPassword(
        value.password,
        user?.password ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
      );
      if (!user || !valid)
        throw new ApiError("Tên đăng nhập hoặc mật khẩu không đúng.", 401);
      await createSession(user.id);
      return json({ ok: true });
    }
    if (route === "auth/logout" && req.method === "POST") {
      await logout();
      return json({ ok: true });
    }
    if (route === "me" && req.method === "GET")
      return json({ user: await getUser() });
    const user = await requireUser();
    if (route === "arena" && req.method === "GET")
      return json(await snapshot(user));
    if (route === "statement" && req.method === "GET") {
      const [contest, pkg, now] = await Promise.all([
        getContest(),
        getPackage(),
        serverNow(),
      ]);
      if (!canRead(contest, now, "statement", user.admin))
        throw new ApiError("Đề chỉ mở khi buổi thi bắt đầu.", 403);
      if (!pkg) throw new ApiError("Chưa nạp đề.", 404);
      return json({ statement: pkg.statement });
    }
    if (route === "download" && req.method === "GET") {
      const resource = new URL(req.url).searchParams.get("asset");
      const [contest, pkg, now] = await Promise.all([
        getContest(),
        getPackage(),
        serverNow(),
      ]);
      const asset = pkg?.assets.find((a) => a.key === resource);
      if (!asset) throw new ApiError("Không tìm thấy tệp.", 404);
      if (!canRead(contest, now, asset.phase, user.admin))
        throw new ApiError("Tệp chưa được phát.", 403);
      await rateLimit(`download:${user.id}`, 20, 60);
      const result = await storage().signedReadUrl(asset.key, {
        expiresIn: "1m",
        downloadAs: asset.name,
      });
      return NextResponse.redirect(result.url, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (route === "submission/download" && req.method === "GET") {
      const c = await getContest(),
        id = new URL(req.url).searchParams.get("id");
      const s = id
        ? await db().hget<Submission>(key(`submissions:${c.id}`), id)
        : null;
      if (!s || (!user.admin && s.teamId !== user.teamId))
        throw new ApiError("Không tìm thấy bản nộp.", 404);
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
      await rateLimit(`team:${user.id}`, 30, 60);
      const value = z
        .discriminatedUnion("action", [
          z.object({
            action: z.literal("create"),
            name: z.string().trim().min(2).max(50),
          }),
          z.object({
            action: z.literal("join"),
            code: z.string().max(40).optional(),
            teamId: z.string().uuid().optional(),
          }),
          z.object({ action: z.literal("leave") }),
          z.object({
            action: z.literal("invite"),
            username: z.string().min(3).max(24),
          }),
          z.object({ action: z.literal("decline"), teamId: z.string().uuid() }),
        ])
        .parse(await payload(req));
      await teamAction(user, value.action, value);
      return json({ ok: true });
    }
    if (route === "password") {
      const value = z
        .object({
          current: z.string().max(128),
          password: z.string().min(10).max(128),
        })
        .parse(await payload(req));
      await rateLimit(`password:${user.id}`, 5, 900);
      const record = await db().get<User>(key(`user:${user.id}`));
      if (!record || !(await checkPassword(value.current, record.password)))
        throw new ApiError("Mật khẩu hiện tại không đúng.");
      const hash = await hashPassword(value.password);
      await db().eval(
        `local u=cjson.decode(redis.call('GET',KEYS[1]));u.password=ARGV[1];redis.call('SET',KEYS[1],cjson.encode(u));return 1`,
        [key(`user:${user.id}`)],
        [hash],
      );
      return json({ ok: true });
    }
    if (route === "submit") {
      await rateLimit(`submit:${user.id}`, 10, 60);
      const raw = await body(req, 3_200_000);
      const form = await new Request(req.url, {
        method: "POST",
        headers: { "content-type": req.headers.get("content-type") ?? "" },
        body: raw,
      }).formData();
      const file = form.get("file"),
        task = z.enum(["1", "2"]).parse(form.get("task")),
        split = z.enum(["public", "private"]).parse(form.get("split")),
        nonce = z.string().uuid().parse(form.get("nonce")),
        note = z
          .string()
          .max(300)
          .parse(form.get("note") ?? "");
      if (
        !(file instanceof File) ||
        !file.name.toLowerCase().endsWith(".csv") ||
        file.size < 1 ||
        file.size > 3_000_000
      )
        throw new ApiError("Chọn một CSV UTF-8, tối đa 3 MB.");
      return json(await submit(user, task, split, file, note, nonce));
    }
    if (route === "select-final") {
      const value = z
        .object({ id: z.string().uuid() })
        .parse(await payload(req));
      await selectFinal(user, value.id);
      return json({ ok: true });
    }
    if (route === "admin/control") {
      await requireAdmin();
      await rateLimit(`admin:${user.id}`, 30, 60);
      const value = z
        .discriminatedUnion("action", [
          z.object({
            action: z.literal("configure"),
            title: z.string().trim().min(3).max(100),
            publicSeconds: z.number().int().min(30).max(43200),
            privateSeconds: z.number().int().min(30).max(7200),
            publicLimit: z.number().int().min(1).max(100),
            privateLimit: z.number().int().min(1).max(20),
          }),
          z.object({
            action: z.literal("schedule"),
            scheduledAt: z.string().datetime(),
          }),
          ...(["start", "cancel", "finish", "new"] as const).map((action) =>
            z.object({ action: z.literal(action) }),
          ),
          z.object({
            action: z.literal("announce"),
            text: z.string().trim().min(1).max(1000),
          }),
        ])
        .parse(await payload(req));
      await control(value.action, value);
      return json({ ok: true });
    }
    if (route === "admin/export") {
      await requireAdmin();
      const data = await snapshot(user);
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
