import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, key, serverNow, storage } from "./db";
import { ApiError, rateLimit } from "./auth";
import {
  getContest,
  getPackage,
  requireRegistration,
  roundKey,
  registrationKey,
} from "./rounds";
import { canRead, phaseOf, chatbotDeadline, notebookAllowed } from "./domain";
import { roundVisible } from "./round-visibility";
import {
  decryptSecret,
  encryptSecret,
  matchesSecret,
} from "./workspace-crypto";
import { Runpod, RunpodError, podOrigin, type RunpodPod } from "./runpod";
import { gpuCloudPrice } from "./gpu-pricing";
import { podStartupMessage } from "./runpod-startup";
import {
  isTeamHub,
  hubImage,
  hubLoginOrigins,
  HUB_PROTOCOL,
  type TeamNotebook,
} from "./hub-domain";
import { hubVisible, hubBound, hubView, readHubReport } from "./hub-store";
import {
  chatbotOpen,
  defaultTemplate,
  driveFileId,
  meter,
  chatContextWindow,
  chatParallel,
  chatPolicyFields,
  workspaceView,
  workspaceAccess,
  capacityRejected,
  type RuntimeHealth,
  type Workspace,
  type WorkspaceTemplate,
} from "./workspace-domain";
import type { Contest, SafeUser, Team } from "./types";
import {
  chatGroupViews,
  getChatGroup,
  groupTemplate,
  groupKey,
} from "./chat-groups";
import {
  chatQueueSummary,
  readQueuedChat,
  enqueueChat,
  workerKey,
  workerJobIds,
  supportedQueueProtocol,
  type ChatWorker,
} from "./chat-queue";
import { readTemplates, saveSharedTemplate } from "./workspace-templates";
import {
  hasService,
  isShared,
  type WorkspaceScope,
  type WorkspaceServices,
} from "./workspace-options";
import {
  requireWorkspaceTeam,
  WORKSPACE_TEAM_ELIGIBILITY_LUA,
} from "./workspace-teams";

const recordKey = (id: string) => key(`gpu:workspace:${id}`);
const activeKey = (team: string) => key(`gpu:active:${team}`);
const credentialKey = (id: string) => key(`gpu:credential:${id}`);
function reservationKeys(w: Workspace) {
  if (w.chatGroupId) return [];
  if (!w.reservationVersion) return [activeKey(w.teamId!)];
  return (["llm", "jupyter"] as const)
    .filter((s) => hasService(w, s))
    .map((s) =>
      key(`gpu:active:v2:${w.scope}:${w.teamId ?? "all"}:${w.roundId}:${s}`),
    );
}
async function releaseReservation(w: Workspace) {
  await db().eval(
    "for i=1,#KEYS do if redis.call('GET',KEYS[i])==ARGV[1] then redis.call('DEL',KEYS[i]) end end;return 1",
    reservationKeys(w),
    [w.id],
  );
}
function sessionKey(w: Workspace, user: SafeUser, sessionId: string) {
  const audience = isShared(w)
    ? `:${user.admin ? `admin-${user.id}` : `team-${user.teamId}`}`
    : "";
  return key(`gpu:chat:${w.id}:${w.runId}${audience}:${sessionId}`);
}
async function allWorkspaces() {
  const ids = await db().smembers<string[]>(key("gpu:workspaces"));
  return ids.length
    ? (await db().mget<(Workspace | null)[]>(...ids.map(recordKey))).filter(
        (w): w is Workspace => !!w,
      )
    : [];
}
async function provider(owner: string) {
  const encrypted = await db().get<string>(credentialKey(owner));
  if (!encrypted)
    throw new ApiError("Admin cần lưu Runpod API key trước.", 409);
  return new Runpod(decryptSecret(encrypted));
}
async function save(w: Workspace) {
  const saved = await db().eval<unknown[], Workspace>(
    `local next=cjson.decode(ARGV[1]);local raw=redis.call('GET',KEYS[1]);if raw then local old=cjson.decode(raw);next.hubTeams=old.hubTeams;if old.runId~=next.runId then next.runId=old.runId;next.roundTitle=old.roundTitle;next.health=cjson.null;next.syncedAt=cjson.null end end;local encoded=cjson.encode(next);redis.call('SET',KEYS[1],encoded);return encoded`,
    [recordKey(w.id)],
    [JSON.stringify(w)],
  );
  Object.assign(w, typeof saved === "string" ? JSON.parse(saved) : saved);
}
async function lock<T>(
  id: string,
  fn: () => Promise<T>,
  seconds = 120,
): Promise<T> {
  const token = randomUUID(),
    k = key(`gpu:lock:${id}`);
  if (!(await db().set(k, token, { nx: true, ex: seconds })))
    throw new ApiError("Thao tác đang được xử lý. Vui lòng chờ.", 409);
  try {
    return await fn();
  } finally {
    await db().eval(
      "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
      [k],
      [token],
    );
  }
}
export async function getWorkspace(id: string) {
  const w = await db().get<Workspace>(recordKey(id));
  if (!w) throw new ApiError("Không tìm thấy GPU Workspace.", 404);
  w.teamId ??= null;
  w.podId ??= null;
  return w;
}
async function currentRun(w: Workspace, c: Contest) {
  if (w.runId === c.id || ["terminated", "failed"].includes(w.status)) return w;
  // Reuse the team's existing Pod when the same round is reset. Patch only run
  // metadata atomically so a concurrent provider reconciliation is not lost.
  const updated = await db().eval<unknown[], Workspace | null>(
    `local round=redis.call('GET',KEYS[2]);if not round or cjson.decode(round).id~=ARGV[1] then return nil end;local raw=redis.call('GET',KEYS[1]);if not raw then return nil end;local w=cjson.decode(raw);if w.status~='terminated' and w.status~='failed' and w.runId~=ARGV[1] then w.runId=ARGV[1];w.roundTitle=ARGV[2];w.health=cjson.null;w.syncedAt=cjson.null;w.updatedAt=tonumber(ARGV[3]);raw=cjson.encode(w);redis.call('SET',KEYS[1],raw) end;return raw`,
    [recordKey(w.id), roundKey(c)],
    [c.id, c.title, await serverNow()],
  );
  if (!updated)
    throw new ApiError("Vòng luyện vừa thay đổi. Vui lòng tải lại.", 409);
  return typeof updated === "string"
    ? (JSON.parse(updated) as Workspace)
    : updated;
}
export async function accessWorkspace(user: SafeUser, id: string) {
  let w = await getWorkspace(id);
  const c = await getContest(w.roundId);
  if (!roundVisible(c, user.admin))
    throw new ApiError("Không tìm thấy vòng luyện.", 404);
  if (!user.admin) {
    const team = user.teamId
      ? await db().hget<Team>(key("teams"), user.teamId)
      : null;
    if (
      !team ||
      (!isShared(w) && team.id !== w.teamId) ||
      !team.members.includes(user.id) ||
      !hubVisible(w, user)
    )
      throw new ApiError("Bạn không thuộc đội được cấp GPU này.", 403);
    if (!isShared(w) || isTeamHub(w)) await requireRegistration(user, c);
  }
  w = await currentRun(w, c);
  w = await withChatPolicy(w);
  return { w, c };
}
export async function withChatPolicy(w: Workspace) {
  const contextWindowTokens =
    w.contextWindowTokens ?? chatContextWindow(w.template);
  const saved = (await readTemplates(w.ownerId))[w.template.id];
  if (!saved) return { ...w, contextWindowTokens };
  const template = { ...w.template };
  for (const field of chatPolicyFields)
    Object.assign(template, { [field]: saved[field] });
  return { ...w, contextWindowTokens, template };
}
export async function workspaceState(user: SafeUser) {
  const [all, now, templates, hasCredential] = await Promise.all([
    allWorkspaces(),
    serverNow(),
    user.admin ? readTemplates(user.id) : null,
    user.admin ? db().exists(credentialKey(user.id)) : false,
  ]);
  const team =
    !user.admin && user.teamId
      ? await db().hget<Team>(key("teams"), user.teamId)
      : null;
  const member = !!team?.members.includes(user.id);
  return {
    chatGroups: await chatGroupViews(user),
    chatOperations: user.admin
      ? await Promise.all(
          all
            .filter((w) => hasService(w, "llm") && w.status !== "terminated")
            .map(async (w) => ({
              id: w.id,
              canManage: w.ownerId === user.id,
              groupId: w.chatGroupId,
              draining: !!(await db().get(key(`gpu:drain:${w.id}`))),
              worker: await db().get<ChatWorker>(workerKey(w.id)),
              queue: !w.chatGroupId
                ? await chatQueueSummary(
                    `workspace:${w.id}`,
                    (await getContest(w.roundId).catch(() => ({ id: w.runId })))
                      .id,
                  )
                : null,
            })),
        )
      : [],
    workspaces: (
      await Promise.all(
        all
          .filter(
            (w) =>
              user.admin ||
              (member &&
                hubVisible(w, user) &&
                (isShared(w) || w.teamId === user.teamId)),
          )
          .map(async (record) => {
            let c: Contest;
            try {
              c = await getContest(record.roundId);
            } catch (error) {
              if (!(error instanceof ApiError) || error.status !== 404)
                throw error;
              return user.admin
                ? {
                    ...workspaceView(record, now, user.admin),
                    notebookEnabled: false,
                    chatbotEnabled: false,
                    accessMessage: "Vòng luyện đã được xóa.",
                  }
                : null;
            }
            if (!roundVisible(c, user.admin)) return null;
            const w = await currentRun(record, c);
            let registered = true;
            try {
              if (!isShared(w) || isTeamHub(w))
                await requireRegistration(user, c);
            } catch {
              registered = false;
            }
            const worker = hasService(w, "llm")
              ? await db().get<ChatWorker>(workerKey(w.id))
              : null;
            const access = workspaceAccess(w, c, now, user.admin, registered);
            return {
              ...workspaceView(await withChatPolicy(w), now, user.admin),
              ...access,
              ...(isTeamHub(w)
                ? {
                    hub: await hubView(w, user, now, c.chatEpoch ?? 0),
                    notebookEnabled: access.notebookEnabled && hubBound(w),
                  }
                : {}),
              chatbotEnabled:
                access.chatbotEnabled &&
                !!worker?.ready &&
                supportedQueueProtocol(worker.protocol) &&
                worker.runId === c.id &&
                now - worker.heartbeatAt < 45000 &&
                !worker.draining,
            };
          }),
      )
    )
      .filter((w) => w !== null)
      .sort((a, b) => b.createdAt - a.createdAt),
    templates: user.admin ? Object.values(templates ?? {}) : [],
    defaultTemplate: user.admin
      ? {
          ...defaultTemplate,
          imageName:
            process.env.RUNPOD_WORKSPACE_IMAGE ??
            "nguyenlong26/olpai-workspace:2026.10.27",
        }
      : null,
    hasCredential: !!hasCredential,
    encryptionReady:
      Buffer.from(process.env.GPU_WORKSPACE_ENCRYPTION_KEY ?? "", "base64")
        .length === 32,
    teams: user.admin
      ? Object.values(
          (await db().hgetall<Record<string, Team>>(key("teams"))) ?? {},
        ).map((t) => ({ id: t.id, name: t.name, members: t.members.length }))
      : [],
    serverNow: now,
  };
}
export async function saveCredential(user: SafeUser, apiKey: string) {
  const encrypted = encryptSecret(apiKey);
  // Validate read access before persisting; never echo provider bodies or the key.
  await new Runpod(apiKey).list();
  const old = await db().get<string>(credentialKey(user.id));
  if (
    old &&
    decryptSecret(old) !== apiKey &&
    (await allWorkspaces()).some(
      (w) =>
        w.ownerId === user.id && !["terminated", "failed"].includes(w.status),
    )
  )
    throw new ApiError(
      "Hãy dừng và thu hồi các Pod hiện có trước khi đổi API key.",
      409,
    );
  await db().set(credentialKey(user.id), encrypted);
}
export async function saveTemplate(
  t: WorkspaceTemplate,
  owner?: string,
  options: { overwrite?: boolean; expectedRevision?: string } = {},
) {
  // Internal QA/legacy setup can still initialize the shared catalogue.
  if (!owner) {
    await db().hset(key("gpu:templates"), { [t.id]: t });
    return t;
  }
  return saveSharedTemplate(t, owner, options);
}
export async function gpuResources(
  user: SafeUser,
  gpuTypeId: string,
  cloudType: WorkspaceTemplate["cloudType"],
) {
  const cache = key(`gpu:resources:${user.id}:${cloudType}:${gpuTypeId}`);
  const old = await db().get<Awaited<ReturnType<Runpod["resources"]>>>(cache);
  if (old) return old;
  const result = await (
    await provider(user.id)
  ).resources(gpuTypeId, cloudType);
  await db().set(cache, result, { ex: 60 });
  return result;
}
export async function setMetricsVisible(
  user: SafeUser,
  id: string,
  visible: boolean,
) {
  if (!user.admin)
    throw new ApiError("Chỉ admin được thay đổi hiển thị thông số GPU.", 403);
  return lock(`pod:${id}`, async () => {
    const w = await getWorkspace(id);
    if (w.status !== "running")
      throw new ApiError(
        "Chỉ thay đổi hiển thị metrics khi Pod đang chạy.",
        409,
      );
    w.metricsVisible = visible;
    await save(w);
    return workspaceView(w, await serverNow(), true);
  });
}
export async function gpuPrices(user: SafeUser) {
  const cacheKey = key(`gpu:prices:${user.id}`),
    cached = await db().get<{
      gpus: Awaited<ReturnType<Runpod["prices"]>>;
      fetchedAt: number;
    }>(cacheKey);
  if (cached) return cached;
  const result = {
    gpus: await (await provider(user.id)).prices(),
    fetchedAt: await serverNow(),
  };
  await db().set(cacheKey, result, { ex: 60 });
  return result;
}
export async function deployWorkspace(
  user: SafeUser,
  teamId: string | null,
  roundId: string,
  templateId: string,
  maxHourlyUsd: number,
  options: {
    scope?: WorkspaceScope;
    services?: WorkspaceServices;
    loadDataset?: boolean;
    groupId?: string;
    requestId?: string;
    retryTemplate?: WorkspaceTemplate;
    teamIds?: string[];
    manual?: boolean;
  } = {},
) {
  const scope = options.scope ?? "team",
    services = options.services ?? "both";
  if (!user.admin) throw new ApiError("Chỉ admin được cấp GPU.", 403);
  const allocationId = options.requestId ?? randomUUID();
  const existing = await db().get<Workspace>(recordKey(allocationId));
  if (existing) {
    if (
      existing.ownerId !== user.id ||
      existing.roundId !== roundId ||
      existing.template.id !== templateId ||
      existing.chatGroupId !== options.groupId ||
      (existing.scope ?? "team") !== scope ||
      (existing.services ?? "both") !== services ||
      existing.teamId !== (scope === "all" ? null : teamId) ||
      !!existing.manual !== !!options.manual ||
      JSON.stringify(existing.hubInitialTeamIds ?? []) !==
        JSON.stringify([...new Set(options.teamIds ?? [])].sort())
    )
      throw new ApiError("Mã cấp phát đã được sử dụng.", 409);
    return workspaceView(existing, await serverNow());
  }
  const group = options.groupId ? await getChatGroup(options.groupId) : null;
  if (
    group &&
    (group.ownerId !== user.id ||
      group.retired ||
      group.roundId !== roundId ||
      group.scope !== scope ||
      group.teamId !== (scope === "all" ? null : teamId) ||
      services !== "llm" ||
      group.template.id !== templateId)
  )
    throw new ApiError("Cấu hình Pod không khớp nhóm Chatbot.", 409);
  if (
    group &&
    (await Promise.all(group.workspaceIds.map(getWorkspace))).some(
      (w) => !w.podId && ["provisioning", "reconciling"].includes(w.status),
    )
  )
    throw new ApiError(
      "Nhóm có allocation chưa xác nhận. Đối soát trước khi thêm Pod.",
      409,
    );
  const [team, c, savedTemplate] = await Promise.all([
    scope === "team" && teamId ? db().hget<Team>(key("teams"), teamId) : null,
    getContest(roundId),
    readTemplates(user.id).then((templates) => templates[templateId]),
  ]);
  const t = group
    ? await groupTemplate(group)
    : (options.retryTemplate ?? savedTemplate);
  if (
    t &&
    services !== "jupyter" &&
    t.imageName.endsWith(
      "@sha256:4510a9e0bfbb96ca83873df7535d61367b594d841387557b561df4ab5a5a94cf",
    )
  )
    throw new ApiError(
      "Image này chưa hỗ trợ hàng đợi Chatbot. Chọn image runtime mới đã publish.",
      409,
    );
  if (scope === "team" && (!team || !team.members.length))
    throw new ApiError("Chỉ cấp GPU cho đội đã được thí sinh tạo.");
  if (scope === "team") await requireWorkspaceTeam(team!, c);
  if (!t) throw new ApiError("Chọn template đã lưu.");
  const teamHub = t.jupyterMode === "team-hub";
  if (
    (teamHub && (services !== "jupyter" || scope !== "all")) ||
    (options.manual && !teamHub)
  )
    throw new ApiError(
      "Hub/manual yêu cầu Jupyter-only, phạm vi chung và template JupyterHub.",
      409,
    );
  if (
    teamHub &&
    (!hubImage(t.imageName) || t.imageName !== process.env.RUNPOD_HUB_IMAGE)
  )
    throw new ApiError(
      "Chọn image JupyterHub đã publish và được server xác nhận bằng RUNPOD_HUB_IMAGE.",
      409,
    );
  if (!teamHub && options.teamIds?.length)
    throw new ApiError("Danh sách team chỉ dùng cho JupyterHub.");
  const initialTeams: Record<string, TeamNotebook> = {};
  for (const id of [...new Set(options.teamIds ?? [])].sort()) {
    const selected = await db().hget<Team>(key("teams"), id);
    if (!selected?.members.length)
      throw new ApiError("Team không tồn tại hoặc chưa có thành viên.");
    await requireWorkspaceTeam(selected, c);
    initialTeams[id] = {
      teamId: id,
      teamName: selected.name,
      enabled: true,
      desiredState: "stopped",
      revision: randomUUID(),
      updatedAt: await serverNow(),
    };
  }
  if (t.services && t.services !== services)
    throw new ApiError(
      "Template không khớp dịch vụ đã chọn. Hãy chọn và lưu template tương ứng.",
      409,
    );
  if (
    services !== "both" &&
    [
      "sha256:22f21a6b87f728d87f9dedd68028985b7a10be0b451a843f52be751682bea817",
      "sha256:47a5b56e4d1f90fccb472fcbdd8129e3d046418c2de0ef09e072ba544e4e75e2",
      "sha256:f3ce6656c68b37f3d574c6b0f7f95243a4eef4de75363c22f2a07e020fd2bba5",
    ].some((digest) => t.imageName.endsWith("@" + digest))
  )
    throw new ApiError(
      "Image trong template này chưa hỗ trợ tách dịch vụ. Hãy tải lại và chọn template đã cập nhật.",
      409,
    );
  if (
    services !== "llm" &&
    options.loadDataset !== false &&
    !(await getPackage(c))
  )
    throw new ApiError("Vòng này chưa có dataset.");
  const controlUrl = process.env.GPU_WORKSPACE_PUBLIC_URL;
  if (!controlUrl || new URL(controlUrl).protocol !== "https:")
    throw new ApiError(
      "Cần GPU_WORKSPACE_PUBLIC_URL là URL HTTPS công khai của web.",
      503,
    );
  const rp = await provider(user.id),
    prices = await gpuPrices(user);
  const price = gpuCloudPrice(
    prices.gpus.find((g) => g.id === t.gpuTypeId)?.price,
    t.cloudType,
  );
  if (
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    price <= 0 ||
    price > maxHourlyUsd
  )
    throw new ApiError(
      "Giá GPU chưa xác định hoặc vượt mức USD/giờ bạn cho phép. Làm mới bảng giá.",
      409,
    );
  const now = await serverNow(),
    id = allocationId;
  const w: Workspace = {
    ...(teamHub
      ? {
          jupyterMode: "team-hub" as const,
          hubTeams: initialTeams,
          hubInitialTeamIds: Object.keys(initialTeams),
        }
      : {}),
    ...(options.manual ? { manual: { state: "prepared" as const } } : {}),
    id,
    teamId: scope === "all" ? null : team!.id,
    teamName: teamHub
      ? "Các team được cấp quyền"
      : scope === "all"
        ? "Tất cả các đội"
        : team!.name,
    scope,
    services,
    ...(group ? { chatGroupId: group.id } : {}),
    allocationRequestId: allocationId,
    maxHourlyUsd,
    reservationVersion: 2,
    roundId,
    loadDataset: services !== "llm" && options.loadDataset !== false,
    runId: c.id,
    roundTitle: c.title,
    ownerId: user.id,
    podName: `arena-${createHash("sha256").update(key("gpu")).digest("hex").slice(0, 8)}-${id}`,
    podId: null,
    status: "provisioning",
    template: t,
    contextWindowTokens: group?.contextWindowTokens ?? chatContextWindow(t),
    secret: encryptSecret(randomBytes(32).toString("base64url")),
    jupyterSecret: encryptSecret(randomBytes(32).toString("base64url")),
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
    meterAt: now,
    meterRate: 0,
    accruedUsd: 0,
    quotedGpuRate: price,
    health: null,
    error: null,
  };
  const slots = reservationKeys(w),
    checks = [...slots];
  if (scope === "team" && !group) {
    const legacyId = await db().get<string>(activeKey(team!.id));
    const legacy = legacyId
      ? await db().get<Workspace>(recordKey(legacyId))
      : null;
    if (legacyId && (!legacy || legacy.roundId === roundId))
      checks.push(activeKey(team!.id));
  }
  const reserved = await db().eval<unknown[], number>(
    `${WORKSPACE_TEAM_ELIGIBILITY_LUA}
     if redis.call('EXISTS',KEYS[#KEYS-2])==1 then return 2 end
     if ARGV[6]~='' and not eligible(ARGV[6],ARGV[7],ARGV[8]) then return 3 end
     local candidate=cjson.decode(ARGV[4]);for tid,_ in pairs(candidate.hubTeams or {}) do if not eligible(tid,ARGV[7],ARGV[8]) then return 3 end end
     if ARGV[5]~='' then local raw=redis.call('GET',KEYS[#KEYS]);if not raw then return 0 end;local g=cjson.decode(raw);if g.retired then return 0 end;table.insert(g.workspaceIds,ARGV[3]);redis.call('SET',KEYS[#KEYS],cjson.encode(g)) end
     for i=1,tonumber(ARGV[1]) do if redis.call('EXISTS',KEYS[i])==1 then return 0 end end;for i=1,tonumber(ARGV[2]) do redis.call('SET',KEYS[i],ARGV[3]) end;redis.call('SET',KEYS[#KEYS-2],ARGV[4]);redis.call('SADD',KEYS[#KEYS-1],ARGV[3]);return 1`,
    [
      ...checks,
      recordKey(id),
      key("gpu:workspaces"),
      group ? groupKey(group.id) : key("gpu:unused-group"),
    ],
    [
      checks.length,
      slots.length,
      id,
      JSON.stringify(w),
      group?.id ?? "",
      scope === "team" ? teamId! : "",
      key("teams"),
      registrationKey(c),
    ],
  );
  if (reserved === 2)
    return workspaceView(await getWorkspace(id), await serverNow());
  if (reserved === 3)
    throw new ApiError(
      "Đội không còn thành viên được duyệt trong vòng luyện đã chọn.",
      409,
    );
  if (!reserved)
    throw new ApiError(
      "Phạm vi này đã có Pod hoặc yêu cầu chờ cung cấp dịch vụ đã chọn trong vòng luyện. Đối soát/thu hồi trước khi cấp lại.",
      409,
    );
  if (options.manual) return workspaceView(w, now);
  try {
    const pod = await rp.create(w.podName, t, workspaceEnvironment(w));
    if (!pod?.id || !/^[a-zA-Z0-9]{5,64}$/.test(pod.id))
      throw new RunpodError(502, true);
    w.podId = pod.id;
    w.meterRate = pod.costPerHr ?? price;
    w.meterAt = await serverNow();
    w.status = "provisioning";
  } catch (e) {
    if (e instanceof RunpodError && e.reason === "capacity")
      w.provisionFailure = "capacity";
    w.status =
      e instanceof RunpodError && !e.uncertain ? "failed" : "reconciling";
    w.meterRate = 0;
    w.error =
      w.status === "reconciling"
        ? "Chưa nhận được xác nhận từ Runpod. Bấm Đối soát; hệ thống không tự tạo Pod thứ hai."
        : e instanceof RunpodError
          ? e.message
          : "Cấp phát thất bại. Đối soát trước khi cấp lại.";
  }
  w.updatedAt = await serverNow();
  await save(w);
  if (capacityRejected(w)) await releaseReservation(w);
  return workspaceView(w, w.updatedAt);
}
export async function retryWorkspace(
  user: SafeUser,
  id: string,
  requestId: string,
) {
  if (id === requestId)
    throw new ApiError("Lần thử lại cần request ID mới.", 409);
  return lock(`pod:${id}`, async () => {
    let w = await getWorkspace(id);
    if (!user.admin || w.ownerId !== user.id)
      throw new ApiError("Pod thuộc quản trị viên khác.", 403);
    if (w.retryRequestId && w.retryRequestId !== requestId)
      throw new ApiError(
        "Yêu cầu này đã được thử lại. Kiểm tra allocation mới trong danh sách GPU.",
        409,
      );
    if (!w.retryRequestId) {
      if (await db().exists(recordKey(requestId)))
        throw new ApiError("Mã lần thử lại đã được sử dụng.", 409);
      if (!capacityRejected(w))
        throw new ApiError(
          "Chỉ thử cấp lại yêu cầu bị từ chối do hết capacity. Các trường hợp mất xác nhận phải đối soát.",
          409,
        );
      w = await syncUnlocked(w);
      if (!capacityRejected(w))
        throw new ApiError(
          "Đã tìm thấy Pod hoặc trạng thái cấp phát thay đổi; không tạo thêm Pod.",
          409,
        );
      w = meter(w, await serverNow(), "terminated", 0);
      w.retryRequestId = requestId;
      await save(w);
      await releaseReservation(w);
    }
    return deployWorkspace(
      user,
      w.teamId,
      w.roundId,
      w.template.id,
      w.maxHourlyUsd ?? w.quotedGpuRate,
      {
        requestId,
        retryTemplate: w.template,
        scope: w.scope ?? "team",
        services: w.services ?? "both",
        loadDataset: w.loadDataset,
        ...(w.chatGroupId ? { groupId: w.chatGroupId } : {}),
      },
    );
  });
}
async function runtime<T>(
  w: Workspace,
  path: string,
  body?: unknown,
  timeout = 7000,
): Promise<T> {
  if (!w.podId) throw new ApiError("Pod chưa được cấp phát.", 409);
  let result: Response;
  try {
    result = await fetch(`${podOrigin(w.podId, 8000)}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${decryptSecret(w.secret)}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ApiError(
      "Dịch vụ trên Pod chưa sẵn sàng hoặc hết thời gian chờ.",
      503,
    );
  }
  if (!result.ok)
    throw new ApiError(
      result.status === 422
        ? "Yêu cầu vượt giới hạn token hoặc không hợp lệ."
        : "Dịch vụ trên Pod đang bận hoặc chưa sẵn sàng.",
      503,
    );
  return (await result.json()) as T;
}
async function syncUnlocked(w: Workspace) {
  if (w.status === "terminated") return w;
  if (w.manual && w.manual.state !== "bound") return w;
  // Repair records written before we stopped metering unconfirmed allocations.
  if (!w.podId) w = { ...w, meterRate: 0, accruedUsd: 0 };
  const rp = await provider(w.ownerId);
  let pod: RunpodPod | undefined;
  // Names are unique per durable allocation; reconcile even explicit provider errors before releasing the reservation.
  if (w.podId) {
    try {
      pod = await rp.get(w.podId!);
    } catch (e) {
      if (!(e instanceof RunpodError && e.status === 404)) throw e;
    }
  } else pod = (await rp.list()).find((p) => p.name === w.podName);
  const now = await serverNow();
  if (!pod) {
    if (w.podId) {
      w = meter(w, now, "terminated", 0);
      w.health = null;
      w.startupFailure = null;
      w.error = "Pod không còn tồn tại trên Runpod.";
    } else {
      if (w.status !== "failed")
        w.error =
          "Chưa tìm thấy Pod. Chưa tính chi phí; giữ khóa cấp phát để tránh tạo trùng. Đối soát lại sau.";
    }
  } else {
    w.podId = pod.id;
    const status =
      pod.desiredStatus === "RUNNING"
        ? "running"
        : pod.desiredStatus === "EXITED" || pod.desiredStatus === "STOPPED"
          ? "stopped"
          : "provisioning";
    w.uptimeSeconds =
      typeof pod.runtime?.uptimeInSeconds === "number"
        ? Math.max(0, pod.runtime.uptimeInSeconds)
        : null;
    w.uptimeObservedAt = now;
    // Storage is an explicit estimate (Runpod volume disk: $0.20/GB/month while stopped).
    const rate =
      status === "stopped"
        ? (w.template.volumeInGb * 0.2) / 730
        : (pod.costPerHr ?? w.quotedGpuRate);
    w = meter(w, now, status, rate);
    w.error = null;
    if (status === "running") {
      try {
        const [health, jupyter] = await Promise.all([
          runtime<RuntimeHealth>(w, "/health"),
          hasService(w, "jupyter")
            ? fetch(`${podOrigin(w.podId!, 8888)}/api/status`, {
                headers: {
                  Authorization: `token ${decryptSecret(w.jupyterSecret)}`,
                },
                signal: AbortSignal.timeout(5000),
                redirect: "error",
                cache: "no-store",
              })
                .then((r) => r.status === 200)
                .catch(() => false)
            : Promise.resolve(false),
        ]);
        w.health = {
          ...health,
          llm: hasService(w, "llm") && health.llm,
          jupyter: health.jupyter && jupyter,
        };
        w.startupFailure = null;
        w.startupCheckedAt = null;
      } catch {
        w.health = null;
        if (pod.runtime) {
          w.startupFailure = null;
          w.error = "Container đang chạy; chưa kết nối được dịch vụ trên Pod.";
        } else {
          // desiredStatus=RUNNING means requested state, not a running container.
          // Keep the allocation and its billing estimate; never auto-create a
          // replacement for a host failure (the original may still be billable).
          if (!w.startupCheckedAt || now - w.startupCheckedAt >= 60000) {
            w.startupFailure =
              (await rp.startupFailure(pod.id)) ?? w.startupFailure;
            w.startupCheckedAt = now;
          }
          w.status = w.startupFailure ? "failed" : "provisioning";
          w.error = w.startupFailure
            ? podStartupMessage(w.startupFailure)
            : "Runpod đã nhận Pod; chưa xác nhận container khởi động. Kiểm tra System Logs trên Runpod nếu tình trạng kéo dài.";
        }
      }
    } else {
      w.health = null;
      w.startupFailure = null;
      w.startupCheckedAt = null;
    }
  }
  w.syncedAt = now;
  await save(w);
  if (w.status === "terminated" || capacityRejected(w))
    await releaseReservation(w);
  return w;
}
export async function syncWorkspace(user: SafeUser, id: string) {
  const { w: cached } = await accessWorkspace(user, id);
  const now = await serverNow();
  if (cached.syncedAt && now - cached.syncedAt < 15000)
    return workspaceView(cached, now, user.admin);
  try {
    return await lock(`pod:${id}`, async () => {
      const record = await getWorkspace(id),
        w = await currentRun(record, await getContest(record.roundId)),
        now = await serverNow();
      if (w.syncedAt && now - w.syncedAt < 15000)
        return workspaceView(await withChatPolicy(w), now, user.admin);
      return workspaceView(
        await withChatPolicy(await syncUnlocked(w)),
        await serverNow(),
        user.admin,
      );
    });
  } catch (error) {
    // Concurrent viewers of a shared Pod can use the latest snapshot while one
    // viewer is already refreshing it. Never coalesce mutations this way.
    if (error instanceof ApiError && error.status === 409)
      return workspaceView(
        await withChatPolicy(await getWorkspace(id)),
        await serverNow(),
        user.admin,
      );
    throw error;
  }
}
export async function controlWorkspace(
  user: SafeUser,
  id: string,
  action: "stop" | "start" | "terminate" | "cancel-failed",
) {
  return lock(`pod:${id}`, async () => {
    let w = await getWorkspace(id);
    if (w.ownerId !== user.id)
      throw new ApiError("Pod thuộc tài khoản quản trị khác.", 403);
    if (w.manual && w.manual.state !== "bound")
      throw new ApiError(
        "Dùng thao tác hồ sơ manual cho Pod chưa gắn hoặc đã gỡ.",
        409,
      );
    if (["stop", "terminate"].includes(action) && hasService(w, "llm")) {
      // Fence every future claim before inspecting all existing slots.
      await db().set(key(`gpu:drain:${id}`), true);
      const worker = await db().get<ChatWorker>(workerKey(id));
      const ids = workerJobIds(worker);
      const jobs = ids.length
        ? await db().mget<({ status: string } | null)[]>(
            ...ids.map((id) => key(`gpu:job:${id}`)),
          )
        : [];
      if (
        jobs.some(
          (job) =>
            job && ["claimed", "running", "uncertain"].includes(job.status),
        )
      ) {
        throw new ApiError(
          "Đã ngừng giao việc mới. Chờ tất cả lượt đang chạy hoàn tất hoặc đối soát trước khi dừng Pod.",
          409,
        );
      }
    }
    w = await syncUnlocked(w);
    const rp = await provider(w.ownerId);
    if (action === "cancel-failed") {
      if (w.podId || w.status !== "failed")
        throw new ApiError(
          "Chỉ hủy yêu cầu bị từ chối rõ ràng và đã đối soát không có Pod.",
          409,
        );
      w = meter(w, await serverNow(), "terminated", 0);
      w.error = null;
    } else {
      if (!w.podId || w.status === "terminated")
        throw new ApiError("Không có Pod để điều khiển.", 409);
      if (action === "stop") {
        await rp.stop(w.podId);
        w.error =
          "Đã gửi lệnh dừng. Đối soát để xác nhận; có phí lưu trữ khi dừng.";
      }
      if (action === "start") {
        await rp.start(w.podId);
        w = meter(w, await serverNow(), "provisioning", w.quotedGpuRate);
        w.error = "Đang khởi động lại Pod.";
      }
      if (action === "terminate") {
        await rp.terminate(w.podId!);
        w = meter(w, await serverNow(), "terminated", 0);
        w.error = null;
      }
    }
    await save(w);
    if (w.status === "terminated") await releaseReservation(w);
    return workspaceView(w, await serverNow());
  });
}
export interface WorkspaceManifest {
  active: boolean;
  phase: string;
  privateLocked: boolean;
  assets: {
    name: string;
    phase: string;
    sha256: string;
    bytes: number;
    workspaceLayout?: "task-root";
    url?: string;
    driveId?: string;
  }[];
  llmEnabled?: boolean;
  runId?: string;
  publicEndsAt?: number | null;
  chatbotEndsAt?: number | null;
  queueProtocol?: number;
  policyExpiresAt?: number;
  services?: WorkspaceServices;
  loadDataset?: boolean;
  hubProtocol?: number;
  hub?: { maxTeamServers: number; teams: TeamNotebook[] };
}
export async function agentManifest(
  id: string,
  authorization: string | null,
): Promise<WorkspaceManifest> {
  let w = await getWorkspace(id);
  if (!matchesSecret(authorization, decryptSecret(w.secret)))
    throw new ApiError("Không có quyền truy cập.", 401);
  if (!hubBound(w))
    return {
      active: false,
      phase: "ended",
      assets: [],
      privateLocked: true,
      llmEnabled: false,
    };
  let c: Contest;
  try {
    c = await getContest(w.roundId);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    return {
      active: false,
      phase: "ended",
      assets: [],
      privateLocked: true,
      llmEnabled: false,
    };
  }
  if (c.hidden)
    return {
      active: false,
      phase: "ended",
      assets: [],
      privateLocked: true,
      llmEnabled: false,
    };
  const now = await serverNow();
  w = await currentRun(w, c);
  if (w.runId !== c.id || w.status === "terminated")
    return { active: false, phase: "ended", assets: [], privateLocked: true };
  const pkg = await getPackage(c);
  // Public is provisioned before the start; private URLs are never sent before its server-side phase gate.
  const assets = await Promise.all(
    (hasService(w, "jupyter") && w.loadDataset !== false
      ? (pkg?.assets ?? [])
      : []
    )
      .filter(
        (a) =>
          /\.(zip|ipynb|py|csv|json|parquet|tar|gz|7z)$/i.test(a.name) &&
          (a.phase === "public" || canRead(c, now, "private")),
      )
      .map(async (a) => ({
        name: a.name,
        phase: a.phase,
        sha256: a.sha256,
        bytes: a.bytes,
        ...(a.workspaceLayout ? { workspaceLayout: a.workspaceLayout } : {}),
        ...(a.driveUrl
          ? { driveId: driveFileId(a.driveUrl) }
          : {
              url: (await storage().signedReadUrl(a.key, { expiresIn: "1h" }))
                .url,
            }),
      })),
  );
  return {
    active: true,
    queueProtocol: 1,
    policyExpiresAt: now + 45000,
    // Legacy agents use this name as their LLM cutoff, independently of the phase.
    publicEndsAt: chatbotDeadline(c, now),
    chatbotEndsAt: chatbotDeadline(c, now),
    services: w.services ?? "both",
    runId: c.id,
    phase: phaseOf(c, now),
    assets,
    loadDataset: hasService(w, "jupyter") && w.loadDataset !== false,
    ...(isTeamHub(w)
      ? {
          hubProtocol: HUB_PROTOCOL,
          hub: {
            maxTeamServers: w.template.maxTeamServers ?? 7,
            teams: Object.values(w.hubTeams ?? {}),
          },
        }
      : {}),
    privateLocked: !canRead(c, now, "private"),
    llmEnabled: chatbotOpen(w, c, now),
  };
}

export function workspaceEnvironment(w: Workspace) {
  const controlUrl = process.env.GPU_WORKSPACE_PUBLIC_URL;
  if (!controlUrl || new URL(controlUrl).protocol !== "https:")
    throw new ApiError("Thiếu URL điều khiển HTTPS.", 503);
  return {
    ARENA_CONTROL_URL: new URL(
      "/api/workspace/manifest",
      controlUrl,
    ).toString(),
    ARENA_WORKSPACE_ID: w.id,
    ARENA_AGENT_TOKEN: decryptSecret(w.secret),
    ...(hasService(w, "jupyter") && !isTeamHub(w)
      ? { JUPYTER_TOKEN: decryptSecret(w.jupyterSecret) }
      : {}),
    ARENA_WORKSPACE_SERVICES: w.services ?? "both",
    ARENA_JUPYTER_MODE: w.jupyterMode ?? "single",
    ARENA_MAX_TEAM_SERVERS: String(w.template.maxTeamServers ?? 7),
    ...(isTeamHub(w)
      ? {
          ARENA_LOGIN_ORIGINS: JSON.stringify(
            hubLoginOrigins(
              controlUrl,
              process.env.GPU_WORKSPACE_LOGIN_ORIGINS,
            ),
          ),
        }
      : {}),
    ARENA_CONTEXT_SIZE: String(
      w.contextWindowTokens ?? chatContextWindow(w.template),
    ),
    ARENA_LLM_PARALLEL: String(chatParallel(w.template)),
  };
}
export {
  provider as workspaceProvider,
  save as saveWorkspaceRecord,
  lock as workspaceLock,
  releaseReservation as releaseWorkspaceReservation,
};
export async function launchNotebook(
  user: SafeUser,
  id: string,
  targetTeamId?: string,
  arenaOrigin?: string,
) {
  const { w, c } = await accessWorkspace(user, id),
    now = await serverNow();
  if (!hasService(w, "jupyter"))
    throw new ApiError("Pod này không cung cấp JupyterLab.", 409);
  if (isTeamHub(w)) {
    const teamId = user.admin ? targetTeamId : user.teamId;
    if (!hubBound(w) || !teamId || !w.hubTeams?.[teamId]?.enabled)
      throw new ApiError("Chọn team đã được cấp quyền trên Hub.", 403);
    if (w.status !== "running" || !w.podId)
      throw new ApiError("Pod chưa chạy.", 409);
    if (!user.admin && !notebookAllowed(c, now))
      throw new ApiError("Quyền mở JupyterLab đang khóa.", 403);
    const allowed = hubLoginOrigins(
      process.env.GPU_WORKSPACE_PUBLIC_URL!,
      process.env.GPU_WORKSPACE_LOGIN_ORIGINS,
    );
    const origin = arenaOrigin ?? allowed[0];
    if (!allowed.includes(origin))
      throw new ApiError(
        "Địa chỉ web này chưa được cấu hình đăng nhập Hub. Mở Arena qua địa chỉ chính.",
        403,
      );
    return `${podOrigin(w.podId, 8888)}/hub/arena-login?teamId=${encodeURIComponent(teamId)}&arenaOrigin=${encodeURIComponent(origin)}`;
  }
  if (!user.admin && (w.runId !== c.id || !notebookAllowed(c, now)))
    throw new ApiError("Quyền mở JupyterLab của vòng này đang khóa.", 403);
  if (w.status !== "running" || !w.podId || !w.health?.jupyter)
    throw new ApiError("JupyterLab chưa sẵn sàng.", 409);
  const health = await runtime<RuntimeHealth>(w, "/health");
  if (!health.jupyter)
    throw new ApiError(
      "JupyterLab đang khởi động. Vui lòng chờ và đối soát lại.",
      409,
    );
  if (!user.admin) {
    const latest = await accessWorkspace(user, id);
    if (
      latest.c.id !== w.runId ||
      !notebookAllowed(latest.c, await serverNow())
    )
      throw new ApiError("Quyền mở JupyterLab vừa thay đổi. Hãy tải lại.", 403);
  }
  return `${podOrigin(w.podId, 8888)}/lab?token=${encodeURIComponent(decryptSecret(w.jupyterSecret))}`;
}
export async function readChat(
  user: SafeUser,
  id: string | undefined,
  sessionId: string,
  groupId?: string,
) {
  return readQueuedChat(user, id, sessionId, groupId);
}
export async function sendChat(
  user: SafeUser,
  id: string | undefined,
  sessionId: string,
  requestId: string,
  content: string,
  groupId?: string,
  expectedRunId?: string,
) {
  return enqueueChat(
    user,
    id,
    sessionId,
    requestId,
    content,
    groupId,
    expectedRunId,
  );
}
