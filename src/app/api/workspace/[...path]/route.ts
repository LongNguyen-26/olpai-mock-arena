import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ApiError,
  rateLimit,
  requireAdmin,
  requireUser,
  sameOrigin,
} from "@/lib/auth";
import { RunpodError } from "@/lib/runpod";
import { templateSchema } from "@/lib/workspace-domain";
import {
  agentManifest,
  controlWorkspace,
  deployWorkspace,
  gpuPrices,
  launchNotebook,
  readChat,
  saveCredential,
  saveTemplate,
  sendChat,
  syncWorkspace,
  workspaceState,
} from "@/lib/workspaces";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers });
async function payload(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError("Thiếu nội dung.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 96000) {
      await reader.cancel();
      throw new ApiError("Nội dung quá lớn.", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("JSON không hợp lệ.");
  }
}
async function handle(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await context.params).path.join("/"),
      url = new URL(req.url);
    const id = () => z.string().uuid().parse(url.searchParams.get("id"));
    if (req.method === "POST") sameOrigin(req);
    if (path === "manifest" && req.method === "GET")
      return json(await agentManifest(id(), req.headers.get("authorization")));
    const user = await requireUser();
    if (path === "state" && req.method === "GET")
      return json(await workspaceState(user));
    if (path === "launch" && req.method === "GET")
      return NextResponse.redirect(await launchNotebook(user, id()), {
        headers,
      });
    if (path === "chat" && req.method === "GET") {
      const workspaceId = id(),
        sessionId = z
          .string()
          .uuid()
          .parse(url.searchParams.get("session") ?? workspaceId);
      return json(await readChat(user, workspaceId, sessionId));
    }
    if (path === "sync" && req.method === "POST") {
      const v = z.object({ id: z.string().uuid() }).parse(await payload(req));
      await rateLimit(`gpu:sync:${user.id}`, 30, 60);
      return json(await syncWorkspace(user, v.id));
    }
    if (path === "chat" && req.method === "POST") {
      const v = z
        .object({
          id: z.string().uuid(),
          session: z.string().uuid(),
          requestId: z.string().uuid(),
          content: z.string().trim().min(1).max(16000),
        })
        .parse(await payload(req));
      return json(
        await sendChat(user, v.id, v.session, v.requestId, v.content),
      );
    }
    if (
      ["credential", "template", "deploy", "control", "prices"].includes(path)
    ) {
      await requireAdmin();
      if (path === "prices" && req.method === "GET")
        return json(await gpuPrices(user));
      if (req.method !== "POST")
        throw new ApiError("Không tìm thấy chức năng.", 404);
      await rateLimit(`gpu:admin:${user.id}`, 20, 60);
      const v = await payload(req);
      if (path === "credential") {
        await saveCredential(
          user,
          z.object({ apiKey: z.string().trim().min(10).max(300) }).parse(v)
            .apiKey,
        );
        return json({ ok: true });
      }
      if (path === "template") {
        await saveTemplate(templateSchema.parse(v));
        return json({ ok: true });
      }
      if (path === "deploy") {
        const p = z
          .object({
            teamId: z.string().uuid(),
            roundId: z.string().uuid(),
            templateId: z.string().uuid(),
            maxHourlyUsd: z.number().positive().max(100),
          })
          .parse(v);
        return json(
          await deployWorkspace(
            user,
            p.teamId,
            p.roundId,
            p.templateId,
            p.maxHourlyUsd,
          ),
        );
      }
      if (path === "control") {
        const p = z
          .object({
            id: z.string().uuid(),
            action: z.enum(["stop", "start", "terminate", "cancel-failed"]),
          })
          .parse(v);
        return json(await controlWorkspace(user, p.id, p.action));
      }
    }
    throw new ApiError("Không tìm thấy chức năng.", 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        { error: e.issues[0]?.message ?? "Dữ liệu không hợp lệ." },
        400,
      );
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    if (e instanceof RunpodError) return json({ error: e.message }, 502);
    // Do not log provider payloads, Pod environment variables, credentials, or prompts.
    console.error(
      "GPU Workspace request failed",
      e instanceof Error ? e.name : "UnknownError",
    );
    return json(
      {
        error:
          "GPU Workspace chưa được cấu hình đầy đủ hoặc dịch vụ tạm thời không khả dụng.",
      },
      503,
    );
  }
}
export const GET = handle;
export const POST = handle;
