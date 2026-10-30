import { createHash, randomBytes } from "node:crypto";
import { db, key, serverNow } from "./db";
import { ApiError } from "./auth";
import { getAdminIds } from "./admins";
import { notebookAllowed } from "./domain";
import { getContest, roundKey } from "./rounds";
import { requireWorkspaceTeam } from "./workspace-teams";
import { decryptSecret, matchesSecret } from "./workspace-crypto";
import {
  accessWorkspace,
  getWorkspace,
  workspaceLock,
  workspaceProvider,
  saveWorkspaceRecord,
  releaseWorkspaceReservation,
  workspaceEnvironment,
} from "./workspaces";
import { workspaceView, meter, type Workspace } from "./workspace-domain";
import {
  HUB_PROTOCOL,
  hubUsername,
  isTeamHub,
  notebookReport,
  type HubReport,
} from "./hub-domain";
import {
  hubBound,
  hubReportKey,
  mutateNotebook,
  readHubReport,
} from "./hub-store";
import { podOrigin } from "./runpod";
import type { SafeUser, Team, User } from "./types";

export async function hubContext(
  user: SafeUser,
  id: string,
  target?: string,
  manage = false,
) {
  const { w, c } = await accessWorkspace(user, id);
  if (!user.admin && target && target !== user.teamId)
    throw new ApiError("Không được chọn workspace của team khác.", 403);
  if (!isTeamHub(w) || !hubBound(w) || w.status === "terminated")
    throw new ApiError("Hub chưa được gắn hoặc đã đóng.", 409);
  if (manage && (!user.admin || w.ownerId !== user.id))
    throw new ApiError("Chỉ admin sở hữu Pod được quản lý.", 403);
  const teamId = user.admin ? target : user.teamId;
  if (!teamId) throw new ApiError("Chọn team.", 400);
  return { w, c, teamId };
}
export async function changeHubTeam(
  user: SafeUser,
  id: string,
  teamId: string,
  action: "grant" | "revoke",
  requestId: string,
  revision?: string,
) {
  const { w, c } = await hubContext(user, id, teamId, true);
  const team = await db().hget<Team>(key("teams"), teamId);
  if (!team?.members.length)
    throw new ApiError("Team không tồn tại hoặc chưa có thành viên.");
  if (action === "grant") await requireWorkspaceTeam(team, c);
  return mutateNotebook(w, c, user, teamId, action, requestId, revision, team);
}
export async function changeHubServer(
  user: SafeUser,
  id: string,
  action: "start" | "stop",
  requestId: string,
  target?: string,
  revision?: string,
) {
  const { w, c, teamId } = await hubContext(user, id, target);
  if (user.admin && w.ownerId !== user.id)
    throw new ApiError("Pod thuộc admin khác.", 403);
  if (
    action === "start" &&
    !user.admin &&
    !notebookAllowed(c, await serverNow())
  )
    throw new ApiError("Quyền Jupyter của vòng đang khóa.", 403);
  if (!w.hubTeams?.[teamId]?.enabled)
    throw new ApiError("Team chưa được cấp quyền.", 403);
  if (action === "start" && w.status !== "running")
    throw new ApiError("Pod chưa chạy.", 409);
  return mutateNotebook(w, c, user, teamId, action, requestId, revision);
}
export async function agentHub(id: string, authorization: string | null) {
  const w = await getWorkspace(id);
  if (!isTeamHub(w) || !matchesSecret(authorization, decryptSecret(w.secret)))
    throw new ApiError("Không có quyền truy cập.", 401);
  return w;
}
export async function receiveHubReport(
  id: string,
  authorization: string | null,
  report: Omit<HubReport, "observedAt">,
) {
  const w = await agentHub(id, authorization),
    c = await getContest(w.roundId);
  if (!hubBound(w) || w.status === "terminated")
    throw new ApiError("Hub chưa gắn.", 403);
  const value = { ...report, observedAt: await serverNow() };
  const stored = await db().eval<unknown[], number>(
    `local round=redis.call('GET',KEYS[1]);local raw=redis.call('GET',KEYS[2]);if not raw or not round then return 0 end;local w=cjson.decode(raw);if cjson.decode(round).id~=ARGV[1] or w.runId~=ARGV[1] or w.status=='terminated' or (w.manual and w.manual.state~='bound') then return 0 end;redis.call('SET',KEYS[3],ARGV[2],'EX',120);return 1`,
    [roundKey(c), key(`gpu:workspace:${id}`), hubReportKey(id)],
    [report.runId, JSON.stringify(value)],
  );
  if (!stored) throw new ApiError("Báo cáo thuộc lượt cũ.", 409);
  return { ok: true };
}
const ticketKey = (ticket: string) =>
  key(`gpu:hub:ticket:${createHash("sha256").update(ticket).digest("hex")}`);
interface LoginTicket {
  epoch: number;
  hostId: string;
  teamId: string;
  userId: string;
  runId: string;
  state: string;
}
export async function authorizeHub(
  user: SafeUser,
  id: string,
  state: string,
  target?: string,
) {
  const { w, c, teamId } = await hubContext(user, id, target);
  if (!w.podId || w.status !== "running" || !w.hubTeams?.[teamId]?.enabled)
    throw new ApiError("Workspace chưa được mở.", 409);
  if (!user.admin && !notebookAllowed(c, await serverNow()))
    throw new ApiError("Quyền Jupyter đang khóa.", 403);
  if (w.hubTeams[teamId].desiredState === "stopped")
    throw new ApiError("Workspace của đội đã dừng. Hãy quay lại Arena và khởi động lại.", 409);
  const server = notebookReport(
    w,
    await readHubReport(id),
    teamId,
    w.runId,
    await serverNow(),
  );
  if (server?.state === "error")
    throw new ApiError(
      server.error ?? "Không khởi động được workspace của đội. Hãy báo quản trị viên kiểm tra runtime.",
      503,
    );
  if (server?.state !== "ready")
    return { pending: true as const, state: server?.state ?? "preparing" };
  const ticket = randomBytes(32).toString("base64url");
  await db().set(
    ticketKey(ticket),
    {
      hostId: id,
      teamId,
      userId: user.id,
      runId: c.id,
      state,
      epoch: c.chatEpoch ?? 0,
    } satisfies LoginTicket,
    { ex: 60, nx: true },
  );
  return {
    url: `${podOrigin(w.podId, 8888)}/hub/arena-login?ticket=${encodeURIComponent(ticket)}&state=${encodeURIComponent(state)}`,
  };
}
export async function redeemHub(
  id: string,
  authorization: string | null,
  ticket: string,
  state: string,
) {
  await agentHub(id, authorization);
  const value = await db().eval<unknown[], LoginTicket | null>(
    `local raw=redis.call('GET',KEYS[1]);if not raw then return nil end;local t=cjson.decode(raw);if t.hostId~=ARGV[1] or t.state~=ARGV[2] then return nil end;redis.call('DEL',KEYS[1]);return raw`,
    [ticketKey(ticket)],
    [id, state],
  );
  if (!value) throw new ApiError("Vé đăng nhập hết hạn hoặc đã dùng.", 401);
  const t: LoginTicket = typeof value === "string" ? JSON.parse(value) : value;
  const stored = await db().get<User>(key(`user:${t.userId}`));
  if (!stored) throw new ApiError("Tài khoản không còn tồn tại.", 403);
  const { password: _p, ...safe } = stored;
  const user: SafeUser = {
    ...safe,
    admin: (await getAdminIds()).includes(stored.id),
  };
  const { w, c } = await hubContext(user, id, t.teamId);
  if (
    c.id !== t.runId ||
    (c.chatEpoch ?? 0) !== t.epoch ||
    !w.hubTeams?.[t.teamId]?.enabled ||
    (!user.admin &&
      (user.teamId !== t.teamId || !notebookAllowed(c, await serverNow())))
  )
    throw new ApiError("Quyền đăng nhập vừa thay đổi.", 403);
  return { username: hubUsername(t.teamId), teamId: t.teamId };
}

async function manualOwner(user: SafeUser, id: string) {
  const w = await getWorkspace(id);
  if (!user.admin || w.ownerId !== user.id || !w.manual || !isTeamHub(w))
    throw new ApiError("Không có quyền quản lý hồ sơ manual.", 403);
  return w;
}
export async function manualConfiguration(user: SafeUser, id: string) {
  const w = await manualOwner(user, id);
  if (!["prepared", "verifying"].includes(w.manual!.state))
    throw new ApiError("Hồ sơ không còn chờ gắn.", 409);
  return {
    podName: w.podName,
    imageName: w.template.imageName,
    ports: "8888/http,8000/http",
    volumeMountPath: "/workspace",
    containerDiskInGb: w.template.containerDiskInGb,
    volumeInGb: w.template.volumeInGb,
    environment: workspaceEnvironment(w),
  };
}
async function inspectManual(w: Workspace, podId: string) {
  const ids = await db().smembers<string[]>(key("gpu:workspaces"));
  const allocations = ids.length
    ? await db().mget<(Workspace | null)[]>(
        ...ids.map((id) => key(`gpu:workspace:${id}`)),
      )
    : [];
  if (
    allocations.some(
      (other) =>
        other &&
        other.id !== w.id &&
        other.podId === podId &&
        other.status !== "terminated",
    )
  )
    throw new ApiError(
      "Pod đã thuộc hồ sơ khác; không tái sử dụng volume giữa các hồ sơ.",
      409,
    );
  const pod = await (await workspaceProvider(w.ownerId)).inspect(podId);
  if (pod.imageName !== w.template.imageName)
    throw new ApiError("Pod không dùng đúng image digest của hồ sơ.", 409);
  const challenge = randomBytes(16).toString("hex");
  const response = await fetch(
    `${podOrigin(podId, 8000)}/identity?challenge=${challenge}`,
    {
      headers: { Authorization: `Bearer ${decryptSecret(w.secret)}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new ApiError(
      "Chưa xác minh được agent. Kiểm tra image, biến môi trường và cổng 8000.",
      409,
    );
  const identity = await response.json();
  if (
    identity.workspaceId !== w.id ||
    identity.podId !== podId ||
    identity.challenge !== challenge ||
    identity.hubProtocol !== HUB_PROTOCOL ||
    identity.services !== "jupyter" ||
    identity.jupyterMode !== "team-hub"
  )
    throw new ApiError("Runtime identity không khớp hồ sơ JupyterHub.", 409);
  return pod;
}
export async function controlManual(
  user: SafeUser,
  id: string,
  action: "inspect" | "attach" | "cancel" | "detach",
  podId?: string,
) {
  return workspaceLock(`pod:${id}`, async () => {
    let w = await manualOwner(user, id);
    if (action === "cancel") {
      if (w.manual!.state === "cancelled")
        return workspaceView(w, await serverNow());
      if (!["prepared", "verifying"].includes(w.manual!.state))
        throw new ApiError("Chỉ hủy hồ sơ chưa gắn.", 409);
      w.manual = { ...w.manual!, state: "cancelled" };
      w.status = "terminated";
      await saveWorkspaceRecord(w);
      await releaseWorkspaceReservation(w);
      return workspaceView(w, await serverNow());
    }
    if (action === "detach") {
      if (w.manual!.state === "detached")
        return workspaceView(w, await serverNow());
      if (w.manual!.state !== "bound")
        throw new ApiError("Pod chưa được gắn.", 409);
      w = meter(w, await serverNow(), w.status, 0);
      w.manual = { ...w.manual!, state: "detached" };
      w.health = null;
      await saveWorkspaceRecord(w);
      await releaseWorkspaceReservation(w);
      return workspaceView(w, await serverNow());
    }
    if (!podId) throw new ApiError("Thiếu Pod ID.");
    if (w.manual!.state === "bound" && w.podId === podId)
      return workspaceView(w, await serverNow());
    if (!["prepared", "verifying"].includes(w.manual!.state))
      throw new ApiError("Hồ sơ không còn chờ gắn.", 409);
    w.manual = { state: "verifying", candidatePodId: podId };
    await saveWorkspaceRecord(w);
    const pod = await inspectManual(w, podId);
    if (action === "inspect")
      return {
        verified: true,
        podId,
        message: "Danh tính đã xác minh; chưa gắn hoặc tải dataset.",
      };
    const now = await serverNow();
    const attached = await db().eval<unknown[], number>(
      `local binding=redis.call('GET',KEYS[1]);if binding and binding~=ARGV[1] then return 0 end;local raw=redis.call('GET',KEYS[2]);local round=redis.call('GET',KEYS[3]);if not raw or not round then return 0 end;local w=cjson.decode(raw);if w.runId~=cjson.decode(round).id or (w.manual.state~='prepared' and w.manual.state~='verifying') then return 0 end;w.podId=ARGV[2];w.manual={state='bound',boundAt=tonumber(ARGV[3])};w.status='provisioning';w.meterAt=tonumber(ARGV[3]);w.meterRate=tonumber(ARGV[4]);w.updatedAt=tonumber(ARGV[3]);redis.call('SET',KEYS[2],cjson.encode(w));redis.call('SET',KEYS[1],ARGV[1]);return 1`,
      [
        key(`gpu:pod-binding:${podId}`),
        key(`gpu:workspace:${id}`),
        roundKey(await getContest(w.roundId)),
      ],
      [
        id,
        podId,
        now,
        typeof pod.costPerHr === "number" ? pod.costPerHr : w.quotedGpuRate,
      ],
    );
    if (!attached)
      throw new ApiError(
        "Pod đã gắn ở nơi khác hoặc lượt luyện vừa thay đổi.",
        409,
      );
    return workspaceView(await getWorkspace(id), now);
  });
}
