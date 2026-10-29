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
import { templateSchema, workspaceCloudSchema } from "@/lib/workspace-domain";
import { workspaceTeams } from "@/lib/workspace-teams";
import { workerAction, settleUncertain } from "@/lib/chat-queue";
import {
  createChatGroup,
  controlChatGroup,
  drainChatWorker,
  getChatGroup,
} from "@/lib/chat-groups";
import {
  agentManifest,
  controlWorkspace,
  deployWorkspace,
  gpuPrices,
  gpuResources,
  setMetricsVisible,
  launchNotebook,
  readChat,
  saveCredential,
  saveTemplate,
  sendChat,
  syncWorkspace,
  workspaceState,
  retryWorkspace,
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
    if (path.startsWith("worker/") && req.method === "POST") {
      const action = z
        .enum(["claim", "prepare", "heartbeat", "complete", "fail"])
        .parse(path.slice(7));
      const v = z
        .object({
          workspaceId: z.string().uuid(),
          protocol: z.number().int(),
          ready: z.boolean(),
          fingerprint: z.string().max(160),
          slot: z.number().int().min(0).max(7).optional(),
          capacity: z.number().int().min(1).max(8).optional(),
          requestId: z.string().uuid().optional(),
          attempt: z.string().uuid().optional(),
          promptTokens: z.number().int().min(1).max(8192).optional(),
          content: z.string().max(96000).optional(),
          inputTokens: z.number().int().min(1).max(8192).optional(),
          outputTokens: z.number().int().min(0).max(4096).optional(),
        })
        .parse(await payload(req));
      if (action === "prepare" && !v.promptTokens)
        throw new ApiError("Thiếu số token.");
      return json(
        await workerAction(action, v, req.headers.get("authorization")),
      );
    }
    if (req.method === "POST") sameOrigin(req);
    if (path === "manifest" && req.method === "GET")
      return json(await agentManifest(id(), req.headers.get("authorization")));
    const user = await requireUser();
    if (path === "teams" && req.method === "GET") {
      await requireAdmin();
      return json(
        await workspaceTeams(
          user,
          z.string().uuid().parse(url.searchParams.get("round")),
        ),
      );
    }
    if (path === "state" && req.method === "GET")
      return json(await workspaceState(user));
    if (path === "launch" && req.method === "GET")
      return NextResponse.redirect(await launchNotebook(user, id()), {
        headers,
      });
    if (path === "chat" && req.method === "GET") {
      const workspaceId = url.searchParams.has("id") ? id() : undefined,
        groupId = url.searchParams.has("groupId")
          ? z.string().uuid().parse(url.searchParams.get("groupId"))
          : undefined,
        sessionId = z
          .string()
          .uuid()
          .parse(url.searchParams.get("session") ?? workspaceId);
      return json(await readChat(user, workspaceId, sessionId, groupId));
    }
    if (path === "sync" && req.method === "POST") {
      const v = z.object({ id: z.string().uuid() }).parse(await payload(req));
      await rateLimit(`gpu:sync:${user.id}`, 30, 60);
      return json(await syncWorkspace(user, v.id));
    }
    if (path === "chat" && req.method === "POST") {
      const v = z
        .object({
          id: z.string().uuid().optional(),
          groupId: z.string().uuid().optional(),
          session: z.string().uuid(),
          requestId: z.string().uuid(),
          content: z.string().trim().min(1).max(16000),
          runId: z.string().uuid().optional(),
        })
        .parse(await payload(req));
      return json(
        await sendChat(
          user,
          v.id,
          v.session,
          v.requestId,
          v.content,
          v.groupId,
          v.runId,
        ),
        202,
      );
    }
    if (
      [
        "credential",
        "template",
        "deploy",
        "control",
        "prices",
        "gpu-resources",
        "metrics",
        "group/create",
        "group/control",
        "group/deploy",
        "worker-drain",
        "retry",
        "job-settle",
      ].includes(path)
    ) {
      await requireAdmin();
      if (path === "prices" && req.method === "GET")
        return json(await gpuPrices(user));
      if (req.method !== "POST")
        throw new ApiError("Không tìm thấy chức năng.", 404);
      await rateLimit(`gpu:admin:${user.id}`, 20, 60);
      const v = await payload(req);
      if (path === "retry") {
        const p = z
          .object({ id: z.string().uuid(), requestId: z.string().uuid() })
          .parse(v);
        return json(await retryWorkspace(user, p.id, p.requestId));
      }
      if (path === "group/create") {
        const p = z
          .object({
            id: z.string().uuid(),
            name: z.string().trim().min(2).max(80),
            scope: z.enum(["team", "all"]),
            teamId: z.string().uuid().nullable().optional(),
            roundId: z.string().uuid(),
            templateId: z.string().uuid(),
          })
          .parse(v);
        return json(await createChatGroup(user, p));
      }
      if (path === "group/control") {
        const p = z
          .object({
            id: z.string().uuid(),
            action: z.enum(["pause", "resume", "retire"]),
          })
          .parse(v);
        return json(await controlChatGroup(user, p.id, p.action));
      }
      if (path === "group/deploy") {
        const p = z
          .object({
            groupId: z.string().uuid(),
            requestId: z.string().uuid(),
            maxHourlyUsd: z.number().positive().max(100),
          })
          .parse(v);
        const g = await getChatGroup(p.groupId);
        return json(
          await deployWorkspace(
            user,
            g.teamId,
            g.roundId,
            g.template.id,
            p.maxHourlyUsd,
            {
              groupId: g.id,
              requestId: p.requestId,
              scope: g.scope,
              services: "llm",
              loadDataset: false,
            },
          ),
        );
      }
      if (path === "worker-drain") {
        const p = z
          .object({ id: z.string().uuid(), draining: z.boolean() })
          .parse(v);
        return json(await drainChatWorker(user, p.id, p.draining));
      }
      if (path === "job-settle") {
        const p = z.object({ requestId: z.string().uuid() }).parse(v);
        return json({ ok: !!(await settleUncertain(user, p.requestId)) });
      }
      if (path === "gpu-resources") {
        const p = z
          .object({
            gpuTypeId: z.string().min(1).max(100),
            cloudType: workspaceCloudSchema,
          })
          .parse(v);
        return json(await gpuResources(user, p.gpuTypeId, p.cloudType));
      }
      if (path === "metrics") {
        const p = z
          .object({ id: z.string().uuid(), visible: z.boolean() })
          .parse(v);
        return json(await setMetricsVisible(user, p.id, p.visible));
      }
      if (path === "credential") {
        await saveCredential(
          user,
          z.object({ apiKey: z.string().trim().min(10).max(300) }).parse(v)
            .apiKey,
        );
        return json({ ok: true });
      }
      if (path === "template") {
        const options = z
          .object({
            overwrite: z.boolean().optional(),
            expectedRevision: z.string().max(64).optional(),
          })
          .parse(v);
        return json(
          await saveTemplate(templateSchema.parse(v), user.id, options),
        );
      }
      if (path === "deploy") {
        const p = z
          .object({
            teamId: z.string().uuid().nullable().optional(),
            scope: z.enum(["team", "all"]).default("team"),
            services: z.enum(["both", "llm", "jupyter"]).default("both"),
            loadDataset: z.boolean().default(true),
            roundId: z.string().uuid(),
            templateId: z.string().uuid(),
            maxHourlyUsd: z.number().positive().max(100),
            requestId: z.string().uuid().optional(),
          })
          .refine((p) => p.scope === "all" || !!p.teamId, {
            message: "Chọn đội được cấp GPU.",
            path: ["teamId"],
          })
          .parse(v);
        return json(
          await deployWorkspace(
            user,
            p.teamId ?? null,
            p.roundId,
            p.templateId,
            p.maxHourlyUsd,
            {
              scope: p.scope,
              services: p.services,
              loadDataset: p.loadDataset,
              requestId: p.requestId,
            },
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
    if (
      req.method === "GET" &&
      new URL(req.url).pathname.endsWith("/workspace/launch")
    ) {
      const message =
        e instanceof ApiError
          ? e.message
          : "JupyterLab chưa sẵn sàng. Vui lòng quay lại GPU Workspace và thử lại sau.";
      const escaped = message
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
      return new Response(
        `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>JupyterLab</title><body><main><h1>JupyterLab</h1><p>${escaped}</p><a href="/">Về GPU Workspace</a></main></body></html>`,
        {
          status: e instanceof ApiError ? e.status : 503,
          headers: {
            ...headers,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy":
              "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          },
        },
      );
    }
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
