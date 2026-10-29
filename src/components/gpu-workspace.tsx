"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import WorkspaceTemplateForm from "./workspace-template-form";
import JupyterHubPanel from "./jupyter-hub";
import { isTeamHub } from "@/lib/hub-domain";
import ChatGroups, { ChatWorkerOperations, GpuBoard } from "./chat-groups";
import { gpuTelemetry } from "@/lib/gpu-telemetry";
import { gpuCloudPrice } from "@/lib/gpu-pricing";
import { templateName } from "@/lib/template-presentation";
import {
  Cpu,
  Activity,
  ArrowUpRight,
  LockKeyhole,
  MessageSquare,
  RefreshCw,
  Save,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import { api, when, type ViewProps } from "./arena-client";
import type { workspaceState } from "@/lib/workspaces";
import type { GpuPrice } from "@/lib/runpod";
import type { WorkspaceTemplate, WorkspaceView } from "@/lib/workspace-domain";
import { capacityRejected } from "@/lib/workspace-domain";
import type { workspaceTeams } from "@/lib/workspace-teams";
import {
  hasService,
  serviceOptions,
  servicesOverlap,
  type WorkspaceScope,
  type WorkspaceServices,
} from "@/lib/workspace-options";
type State = Awaited<ReturnType<typeof workspaceState>>;
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(n);
const statusNames = {
  provisioning: "Đang cấp phát",
  reconciling: "Chờ đối soát",
  running: "Pod đang chạy",
  stopped: "Đã dừng",
  terminated: "Đã thu hồi",
  failed: "Cấp phát bị từ chối",
};
export default function GpuWorkspace({ data }: ViewProps) {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [syncWarning, setSyncWarning] = useState(""),
    [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState(""),
    [template, setTemplate] = useState<WorkspaceTemplate | null>(null),
    [teamId, setTeamId] = useState(""),
    [scope, setScope] = useState<WorkspaceScope>("team"),
    [groupId, setGroupId] = useState(""),
    [groupName, setGroupName] = useState("Chatbot chung — Thi thử"),
    [services, setServices] = useState<WorkspaceServices>("both"),
    [loadDataset, setLoadDataset] = useState(true),
    [hubTeamIds, setHubTeamIds] = useState<string[]>([]),
    [manualDeploy, setManualDeploy] = useState(false),
    [roundId, setRoundId] = useState(
      data.contest?.roundId ?? data.rounds[0]?.id ?? "",
    );
  const [prices, setPrices] = useState<{
      gpus: GpuPrice[];
      fetchedAt: number;
    } | null>(null),
    [maxHourlyUsd, setMaxHourlyUsd] = useState(0.75),
    [confirmId, setConfirmId] = useState(""),
    [allocationTab, setAllocationTab] = useState<"current" | "history">(
      "current",
    );
  const templateDrafts = useRef<
    Partial<Record<WorkspaceServices, WorkspaceTemplate>>
  >({});
  const resourceSequence = useRef(0);
  const retryRequests = useRef<Record<string, string>>({});
  const [teamOptions, setTeamOptions] = useState<
    Awaited<ReturnType<typeof workspaceTeams>> & {
      loading?: boolean;
      error?: string;
    }
  >({ roundId: "", teams: [] });
  const allocationRequest = useRef("");
  const groupRequest = useRef({ signature: "", id: "" });
  const templateBaseline = useRef<WorkspaceTemplate[]>([]);
  const [resourceBusy, setResourceBusy] = useState(false),
    [resourceMessage, setResourceMessage] = useState(""),
    [overwrite, setOverwrite] = useState(false);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const load = useCallback(async () => {
    try {
      const next: State = await api("workspace/state");
      const previous = templateBaseline.current;
      templateBaseline.current = next.templates;
      setState(next);
      setTemplate((t) => {
        if (!t)
          return (
            next.templates.find((t) => !t.services || t.services === "both") ??
            next.defaultTemplate
          );
        const old = previous.find((s) => s.id === t.id);
        const unchanged =
          old &&
          Object.entries(t).every(
            ([field, value]) => Reflect.get(old, field) === value,
          );
        return unchanged ? (next.templates.find((s) => s.id === t.id) ?? t) : t;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(
      () => void load(),
      data.user.admin ? 10000 : 30000,
    );
    return () => clearInterval(timer);
  }, [load, data.user.admin]);
  useEffect(() => {
    if (!data.user.admin || !roundId) return;
    let active = true;
    setTeamOptions((previous) => ({
      roundId,
      teams: previous.roundId === roundId ? previous.teams : [],
      loading: previous.roundId !== roundId || !previous.teams.length,
    }));
    void api("workspace/teams", undefined, roundId)
      .then((result: Awaited<ReturnType<typeof workspaceTeams>>) => {
        if (!active) return;
        setTeamOptions(result);
        setTeamId((selected) =>
          result.teams.some((t) => t.id === selected) ? selected : "",
        );
      })
      .catch((e: Error) => {
        if (active) setTeamOptions({ roundId, teams: [], error: e.message });
      });
    return () => {
      active = false;
    };
  }, [data.user.admin, roundId, state?.serverNow]);
  const eligibleTeams =
    teamOptions.roundId === roundId ? teamOptions.teams : [];
  useEffect(() => {
    if (services === "jupyter" && template?.jupyterMode === "team-hub")
      setScope("all");
  }, [services, template?.jupyterMode]);
  useEffect(() => {
    if (!data.user.admin || !state?.hasCredential) return;
    let active = true;
    const refreshPrices = async () => {
      try {
        const next = await api("workspace/prices");
        if (active) setPrices(next);
      } catch {
        /* Keep the timestamp of the last successful quote; manual refresh reports errors. */
      }
    };
    void refreshPrices();
    const timer = setInterval(() => void refreshPrices(), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [data.user.admin, state?.hasCredential]);
  useEffect(() => {
    if (data.contest?.roundId) setRoundId(data.contest.roundId);
  }, [data.contest?.roundId]);
  const syncIds =
    state?.workspaces
      .filter(
        (w) =>
          w.status !== "terminated" && (w.status !== "failed" || !!w.podId),
      )
      .map((w) => w.id)
      .join(",") ?? "";
  // Refresh shared and private Pods, not just the first allocation.
  useEffect(() => {
    const ids = syncIds ? syncIds.split(",") : [];
    if (!ids.length) return;
    let active = true;
    const refresh = async () => {
      try {
        const results = await Promise.allSettled(
          ids.map((id) => api("workspace/sync", { id })),
        );
        const failed = results.find((r) => r.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        if (active) {
          setSyncWarning("");
          await load();
        }
      } catch (e) {
        if (active)
          setSyncWarning(
            `Chưa cập nhật được trạng thái Pod: ${(e as Error).message} Thời điểm đối soát cuối vẫn được hiển thị bên dưới.`,
          );
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [syncIds, load]);
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit<K extends keyof WorkspaceTemplate>(
    field: K,
    value: WorkspaceTemplate[K],
  ) {
    setOverwrite(false);
    setTemplate((t) => (t ? { ...t, [field]: value } : t));
  }
  function selectTemplate(next: WorkspaceTemplate | null) {
    resourceSequence.current++;
    setResourceBusy(false);
    setResourceMessage("");
    setOverwrite(false);
    setTemplate(
      next ??
        (state?.defaultTemplate
          ? {
              ...state.defaultTemplate,
              id: crypto.randomUUID(),
              services,
              llmParallel: services === "llm" ? 4 : 1,
              name: "",
              tokenLimitMode: "turn",
              revision: undefined,
            }
          : null),
    );
  }
  async function changeGpu(
    gpuTypeId: string,
    cloudType: WorkspaceTemplate["cloudType"],
  ) {
    const version = ++resourceSequence.current;
    setOverwrite(false);
    setResourceBusy(true);
    setResourceMessage("");
    setTemplate((t) =>
      t ? { ...t, gpuTypeId, cloudType, minRAMPerGPU: 0, minVCPUPerGPU: 0 } : t,
    );
    try {
      const result = await api("workspace/gpu-resources", {
        gpuTypeId,
        cloudType,
      });
      if (version !== resourceSequence.current) return;
      if (result.minRAMPerGPU && result.minVCPUPerGPU) {
        setTemplate((t) =>
          t && t.gpuTypeId === gpuTypeId && t.cloudType === cloudType
            ? {
                ...t,
                minRAMPerGPU: result.minRAMPerGPU,
                minVCPUPerGPU: result.minVCPUPerGPU,
              }
            : t,
        );
        setResourceMessage(
          `Runpod: ${result.minRAMPerGPU} GB RAM hệ thống · ${result.minVCPUPerGPU} vCPU tối thiểu cho 1 GPU. Tài nguyên thực nhận phụ thuộc host được cấp.`,
        );
      } else
        setResourceMessage(
          "Runpod chưa có thông số RAM/vCPU cho GPU/cloud này. Nhập yêu cầu tối thiểu thủ công trước khi lưu; không dùng VRAM làm RAM hệ thống.",
        );
    } catch (e) {
      if (version === resourceSequence.current)
        setResourceMessage(
          `Chưa lấy được RAM/vCPU: ${(e as Error).message} Hãy chọn lại hoặc nhập tối thiểu thủ công.`,
        );
    } finally {
      if (version === resourceSequence.current) setResourceBusy(false);
    }
  }
  function saveSelectedTemplate(confirmed = false) {
    if (!template || !state || busy || resourceBusy) return;
    const original = state.templates.find((t) => t.id === template.id);
    if (original && !confirmed) {
      setOverwrite(true);
      return;
    }
    void run(async () => {
      const saved: WorkspaceTemplate = await api("workspace/template", {
        ...template,
        services,
        tokenLimitMode: template.tokenLimitMode ?? "turn",
        overwrite: !!original,
        expectedRevision: original
          ? (template.revision ?? "legacy")
          : undefined,
      });
      setTemplate(saved);
      templateDrafts.current[services] = saved;
      setOverwrite(false);
    }, "Đã lưu template; giới hạn chatbot được cập nhật theo cấu hình mới.");
  }
  function chooseServices(next: WorkspaceServices) {
    if (busy || next === services || !state) return;
    resourceSequence.current++;
    setResourceBusy(false);
    setResourceMessage("");
    setOverwrite(false);
    const basis = template ?? state.defaultTemplate;
    if (!basis) return;
    if (template) templateDrafts.current[services] = template;
    const label = serviceOptions.find((s) => s.id === next)!.label;
    const target = templateDrafts.current[next] ??
      state.templates.find((t) => (t.services ?? "both") === next) ?? {
        ...basis,
        ...(next === "jupyter"
          ? {
              sessionTokenLimit:
                state.defaultTemplate?.sessionTokenLimit ?? 2000,
              inputTokenLimit: state.defaultTemplate?.inputTokenLimit ?? 1800,
              outputTokenLimit: state.defaultTemplate?.outputTokenLimit ?? 1024,
            }
          : {}),
        id: crypto.randomUUID(),
        services: next,
        jupyterMode: next === "jupyter" ? basis.jupyterMode : undefined,
        llmParallel: next === "llm" ? 4 : 1,
        name: `${label} · ${basis.gpuTypeId}`.slice(0, 80),
      };
    setServices(next);
    setTemplate(target);
  }
  const chosen = prices?.gpus.find((g) => g.id === template?.gpuTypeId),
    hourly = template ? gpuCloudPrice(chosen?.price, template.cloudType) : null;
  const teamHub =
    services === "jupyter" && template?.jupyterMode === "team-hub";
  const hasActive = state?.workspaces.some(
    (w) =>
      w.scope === scope &&
      (scope === "all" || w.teamId === teamId) &&
      w.roundId === roundId &&
      servicesOverlap(w.services, services) &&
      w.status !== "terminated" &&
      w.manual?.state !== "detached" &&
      !capacityRejected(w) &&
      services !== "llm",
  );
  const templateSaved =
    !!template &&
    !!state?.templates.some(
      (t) =>
        t.id === template.id &&
        (t.services ?? "both") === services &&
        Object.entries(template).every(
          ([field, value]) => Reflect.get(t, field) === value,
        ),
    );
  const duplicateName =
    !!template &&
    !!state?.templates.some(
      (t) =>
        t.id !== template.id &&
        templateName(t.name) === templateName(template.name),
    );
  const current =
    state?.workspaces.filter((w) => w.status !== "terminated") ?? [];
  const history =
    state?.workspaces.filter((w) => w.status === "terminated") ?? [];
  const visibleWorkspaces =
    allocationTab === "current"
      ? current.filter(
          (w) =>
            !w.chatGroupId ||
            !state?.chatGroups.some((g) => g.id === w.chatGroupId),
        )
      : history;
  const matchingGroups =
    state?.chatGroups.filter(
      (g) =>
        g.canManage &&
        g.roundId === roundId &&
        g.scope === scope &&
        g.teamId === (scope === "all" ? null : teamId),
    ) ?? [];
  const selectedGroup = matchingGroups.find((g) => g.id === groupId);
  async function deploySelected() {
    if (!template) return;
    allocationRequest.current ||= crypto.randomUUID();
    if (services === "llm") {
      let chosenGroup = selectedGroup?.id;
      if (!chosenGroup) {
        const signature = JSON.stringify([
          scope,
          teamId,
          roundId,
          template.id,
          groupName,
        ]);
        if (groupRequest.current.signature !== signature)
          groupRequest.current = { signature, id: crypto.randomUUID() };
        const created = await api("workspace/group/create", {
          id: groupRequest.current.id,
          name: groupName,
          scope,
          teamId: scope === "all" ? null : teamId,
          roundId,
          templateId: template.id,
        });
        chosenGroup = created.id;
        setGroupId(created.id);
      }
      await api("workspace/group/deploy", {
        groupId: chosenGroup,
        requestId: allocationRequest.current,
        maxHourlyUsd,
      });
    } else {
      await api(
        teamHub && manualDeploy
          ? "workspace/manual/prepare"
          : "workspace/deploy",
        {
          teamId: scope === "team" ? teamId : null,
          scope,
          services,
          loadDataset,
          roundId,
          templateId: template.id,
          maxHourlyUsd,
          requestId: allocationRequest.current,
          ...(teamHub
            ? {
                teamIds: hubTeamIds.filter((id) =>
                  eligibleTeams.some((t) => t.id === id),
                ),
              }
            : {}),
        },
      );
    }
    allocationRequest.current = "";
  }
  function renderWorkspace(w: WorkspaceView, canManage = data.user.admin) {
    return (
      <div key={w.id} className={isTeamHub(w) ? "hub-host" : undefined}>
        <WorkspaceCard
          w={w}
          observedNow={state!.serverNow}
          admin={data.user.admin}
          canManage={canManage && (!isTeamHub(w) || !!w.hub?.canManage)}
          retry={() =>
            void run(async () => {
              retryRequests.current[w.id] ||= crypto.randomUUID();
              const result: WorkspaceView = await api("workspace/retry", {
                id: w.id,
                requestId: retryRequests.current[w.id],
              });
              if (capacityRejected(result)) {
                await load();
                throw new Error(
                  result.error ??
                    "Runpod vẫn hết capacity. Có thể thử lại từ yêu cầu mới.",
                );
              }
            }, "Đã thử cấp GPU lại; xem allocation mới trong danh sách.")
          }
          busy={busy}
          confirm={confirmId === w.id}
          onConfirm={() => setConfirmId(w.id)}
          onCancel={() => setConfirmId("")}
          sync={() =>
            void run(
              () => api("workspace/sync", { id: w.id }),
              "Đã đối soát trạng thái.",
            )
          }
          control={(action) =>
            void run(async () => {
              await api("workspace/control", { id: w.id, action });
              setConfirmId("");
            }, "Đã xử lý yêu cầu điều khiển Pod.")
          }
          toggleMetrics={() =>
            void run(
              () =>
                api("workspace/metrics", {
                  id: w.id,
                  visible: w.metricsVisible === false,
                }),
              w.metricsVisible === false
                ? "Đã hiện metrics GPU cho đội thi."
                : "Đã ẩn metrics GPU với đội thi.",
            )
          }
        />
        {isTeamHub(w) && (
          <JupyterHubPanel
            w={w}
            admin={data.user.admin}
            teamId={data.user.teamId}
            busy={busy}
            run={run}
            refresh={load}
          />
        )}
      </div>
    );
  }
  return (
    <div className="gpu-workspace">
      <div className="gpu-workspace-head">
        <div>
          <p>Truy cập Chatbot và JupyterLab của đội tại đây.</p>
        </div>
        <div className="gpu-head-actions">
          {notice && (
            <span className="gpu-inline-notice" role="status">
              {notice}
            </span>
          )}
          <button className="btn" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={16} />
            Làm mới
          </button>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {syncWarning && (
        <div className="alert" role="status">
          {syncWarning}
        </div>
      )}
      {!state && <p role="status">Đang tải GPU Workspace…</p>}
      {state && (
        <section className="gpu-allocations">
          <div className="section-title">
            <div
              className="segmented gpu-allocation-tabs"
              aria-label="Danh sách GPU"
            >
              <button
                aria-pressed={allocationTab === "current"}
                className={allocationTab === "current" ? "active" : ""}
                onClick={() => setAllocationTab("current")}
              >
                GPU hiện tại <span>{current.length}</span>
              </button>
              <button
                aria-pressed={allocationTab === "history"}
                className={allocationTab === "history" ? "active" : ""}
                onClick={() => setAllocationTab("history")}
              >
                Đã thu hồi <span>{history.length}</span>
              </button>
            </div>
          </div>
          {allocationTab === "current" && (
            <ChatGroups
              state={state}
              admin={data.user.admin}
              busy={busy}
              run={run}
              renderWorkspace={renderWorkspace}
              onAddPod={(g) => {
                chooseServices("llm");
                setScope(g.scope);
                setTeamId(g.teamId ?? "");
                setRoundId(g.roundId);
                setGroupId(g.id);
                const saved = state.templates.find(
                  (t) => t.id === g.templateId,
                );
                if (saved) setTemplate(saved);
                document
                  .querySelector(".gpu-deploy-panel")
                  ?.scrollIntoView({ block: "center", behavior: "smooth" });
              }}
            />
          )}
          {allocationTab === "current" &&
            !current.length &&
            !state.chatGroups.length && (
              <EmptyWorkspace
                teamName={data.team?.name}
                admin={data.user.admin}
              />
            )}
          {allocationTab === "history" && !history.length && (
            <div className="panel gpu-empty">
              <Cpu size={30} />
              <h3>Chưa có GPU đã thu hồi</h3>
              <p>Lịch sử GPU sẽ xuất hiện tại đây.</p>
            </div>
          )}
          {(["all", "team"] as const).map((group) => {
            const items = visibleWorkspaces.filter((w) => w.scope === group);
            if (!items.length) return null;
            return (
              <section className="gpu-allocation-group" key={group}>
                <h3>
                  {group === "all"
                    ? "Pod dùng chung"
                    : data.user.admin
                      ? "Pod riêng theo đội"
                      : "Pod riêng của đội bạn"}{" "}
                  <small>({items.length})</small>
                </h3>
                {group === "all" && (
                  <p className="gpu-hint">
                    Chi phí là của toàn Pod chung, không nhân theo số đội. Các
                    đội dùng chung tài nguyên xử lý.
                  </p>
                )}
                <div className="gpu-card-grid">
                  {items.map((w) => renderWorkspace(w))}
                </div>
              </section>
            );
          })}
          <p className="gpu-hint">
            Chi phí là ước tính theo đơn giá × thời gian quan sát, có thể khác
            hóa đơn Runpod. Dừng Pod vẫn có phí volume; thu hồi Pod xóa dữ liệu
            volume của Pod. Đóng tab không dừng kernel hay dừng tính phí.
          </p>
        </section>
      )}
      {state && data.user.admin && (
        <ChatWorkerOperations state={state} busy={busy} run={run} />
      )}
      {state && data.user.admin && (
        <>
          <section className="panel gpu-panel">
            <h2>
              <ShieldCheck size={21} />
              Kết nối Runpod
            </h2>
            <p>
              Pod được cấp bằng tài khoản Runpod của bạn. API key được mã hóa
              trên server và không gửi cho thí sinh.
            </p>
            {!state.encryptionReady && (
              <div className="alert error">
                Server cần cấu hình GPU_WORKSPACE_ENCRYPTION_KEY trước khi lưu
                API key.
              </div>
            )}
            <form
              className="gpu-key-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("workspace/credential", { apiKey });
                  setApiKey("");
                }, "Đã kiểm tra và lưu kết nối Runpod.");
              }}
            >
              <label>
                Runpod API key{" "}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    state.hasCredential
                      ? "Đã lưu · nhập key mới để thay thế"
                      : "Nhập API key của admin"
                  }
                  required
                  minLength={10}
                />
              </label>
              <button
                className="btn primary"
                disabled={busy || !state.encryptionReady}
              >
                <Save size={16} />
                {state.hasCredential ? "Cập nhật key" : "Lưu kết nối"}
              </button>
            </form>
          </section>
          <section className="panel gpu-panel gpu-service-picker">
            <div>
              <h2>Dịch vụ trên Pod</h2>
              <p>Chọn dịch vụ để thiết lập template và cấp Pod tương ứng.</p>
            </div>
            <div
              className="gpu-choice-grid gpu-choice-services"
              aria-label="Dịch vụ trên Pod"
            >
              {serviceOptions.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={services === mode.id}
                  disabled={busy}
                  onClick={() => chooseServices(mode.id)}
                >
                  <strong>{mode.label}</strong>
                  <span>{mode.description}</span>
                </button>
              ))}
            </div>
          </section>
          <div className="gpu-admin-grid gpu-setup-grid">
            {template && (
              <WorkspaceTemplateForm
                template={template}
                templates={state.templates.filter(
                  (t) => (t.services ?? "both") === services,
                )}
                services={services}
                gpus={prices?.gpus ?? []}
                busy={busy}
                saved={templateSaved}
                duplicateName={duplicateName}
                resourceBusy={resourceBusy}
                resourceMessage={resourceMessage}
                overwrite={overwrite}
                onEdit={edit}
                onSelect={selectTemplate}
                onGpuChange={(gpu, cloud) => void changeGpu(gpu, cloud)}
                onSave={saveSelectedTemplate}
                onCancelOverwrite={() => setOverwrite(false)}
                onClone={() =>
                  selectTemplate({
                    ...template,
                    services,
                    id: crypto.randomUUID(),
                    name: "",
                    revision: undefined,
                    tokenLimitMode: template.tokenLimitMode ?? "turn",
                  })
                }
              />
            )}
            <section className="panel gpu-panel gpu-deploy-panel">
              <h2>
                <Zap size={21} />
                Cấu hình Pod mới
              </h2>
              <p>
                {services === "jupyter"
                  ? "Chỉ chạy JupyterLab, không tải hoặc nạp LLM. GPU dành cho notebook của người dùng."
                  : services === "llm"
                    ? "Chạy DeepSeek 32B Q4, không khởi động JupyterLab. Các yêu cầu chat dùng chung GPU."
                    : "DeepSeek 32B Q4 và JupyterLab dùng chung GPU. VRAM còn lại và tốc độ phụ thuộc notebook đang chạy."}
              </p>
              <button
                className="btn"
                disabled={busy || !state.hasCredential}
                onClick={() =>
                  void run(
                    async () => setPrices(await api("workspace/prices")),
                    "Đã cập nhật giá Runpod.",
                  )
                }
              >
                <RefreshCw size={16} />
                Cập nhật giá
              </button>
              {prices && (
                <small className="gpu-price-time">
                  Báo giá {when(prices.fetchedAt)} · cache tối đa 60 giây
                </small>
              )}
              {hourly != null && (
                <div className="gpu-quote">
                  <strong>
                    {money(hourly)}
                    <small>/giờ GPU</small>
                  </strong>
                  <span>
                    6 giờ: {money(hourly * 6)} / Pod, cộng lưu trữ và thuế.
                  </span>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!template) return;
                  void run(deploySelected, "Đã gửi yêu cầu cấp Pod.");
                }}
              >
                {!teamHub && (
                  <fieldset className="gpu-choices">
                    <legend>Phạm vi sử dụng</legend>
                    <div className="gpu-choice-grid">
                      <button
                        type="button"
                        aria-pressed={scope === "team"}
                        onClick={() => setScope("team")}
                      >
                        <strong>Riêng một đội</strong>
                        <span>Chỉ thành viên đội được truy cập</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={scope === "all"}
                        onClick={() => setScope("all")}
                      >
                        <strong>Chung tất cả đội</strong>
                        <span>Một Pod, mọi đội cùng sử dụng</span>
                      </button>
                    </div>
                  </fieldset>
                )}

                {scope === "all" && !teamHub && (
                  <p className="gpu-share-note">
                    Áp dụng cho mọi đội hiện có và đội được tạo sau này.{" "}
                    {services !== "llm"
                      ? "Jupyter chung chia sẻ tệp, kernel và GPU giữa các đội."
                      : "Các đội dùng chung GPU; lịch sử và token chat tách theo đội."}
                    {services === "both" &&
                      " Lịch sử và token chat tách theo đội."}
                    {services !== "jupyter" &&
                      " Chatbot xử lý một yêu cầu tại một thời điểm."}
                  </p>
                )}
                {scope === "team" && !teamHub && (
                  <>
                    <label>
                      Đội thi
                      <select
                        required
                        disabled={!roundId || teamOptions.loading}
                        value={teamId}
                        onChange={(e) => {
                          setTeamId(e.target.value);
                          setGroupId("");
                          allocationRequest.current = "";
                        }}
                      >
                        <option value="">
                          Chọn đội đã được duyệt vào vòng
                        </option>
                        {eligibleTeams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} · {t.approvedMembers}/{t.members} đã duyệt
                          </option>
                        ))}
                      </select>
                    </label>
                    {(!eligibleTeams.length || teamOptions.error) && (
                      <p>
                        {teamOptions.error ??
                          (teamOptions.loading
                            ? "Đang tải đội đã được duyệt…"
                            : "Chưa có đội có thành viên được duyệt trong vòng đã chọn.")}
                      </p>
                    )}
                  </>
                )}
                <label>
                  {services === "llm" ? "Vòng luyện áp dụng giờ Chatbot" : "Vòng luyện áp dụng quyền truy cập"}
                  <select
                    value={roundId}
                    required
                    onChange={(e) => {
                      setRoundId(e.target.value);
                      setTeamId("");
                      setGroupId("");
                      allocationRequest.current = "";
                    }}
                  >
                    <option value="">Chọn vòng luyện</option>
                    {data.rounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                        {r.id === data.contest?.roundId
                          ? " (vòng đang xem)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {teamHub && (
                  <>
                    <fieldset className="hub-team-picker">
                      <legend>
                        Team được cấp quyền ban đầu (có thể để trống)
                      </legend>
                      {eligibleTeams.map((t) => (
                        <label key={t.id}>
                          <input
                            type="checkbox"
                            checked={hubTeamIds.includes(t.id)}
                            onChange={(e) => {
                              setHubTeamIds((ids) =>
                                e.target.checked
                                  ? [...ids, t.id]
                                  : ids.filter((id) => id !== t.id),
                              );
                              allocationRequest.current = "";
                            }}
                          />{" "}
                          {t.name}
                        </label>
                      ))}
                      <p className="gpu-hint">
                        Có thể thêm team sau khi deploy, không khởi động lại
                        Pod.
                      </p>
                    </fieldset>
                    <label>
                      Cách cấp Pod
                      <select
                        value={manualDeploy ? "manual" : "automatic"}
                        onChange={(e) => {
                          setManualDeploy(e.target.value === "manual");
                          allocationRequest.current = "";
                        }}
                      >
                        <option value="automatic">
                          Arena cấp Pod qua Runpod API
                        </option>
                        <option value="manual">
                          Chuẩn bị cấu hình để deploy Runpod thủ công
                        </option>
                      </select>
                    </label>
                  </>
                )}
                {services === "llm" && (
                  <>
                    <label>
                      Nhóm Chatbot
                      <select
                        value={selectedGroup?.id ?? ""}
                        onChange={(e) => {
                          setGroupId(e.target.value);
                          allocationRequest.current = "";
                        }}
                      >
                        <option value="">Tạo nhóm mới</option>
                        {matchingGroups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} · {g.total} Pod
                          </option>
                        ))}
                      </select>
                    </label>
                    {!selectedGroup && (
                      <label>
                        Tên nhóm
                        <input
                          value={groupName}
                          onChange={(e) => setGroupName(e.target.value)}
                          minLength={2}
                          maxLength={80}
                          required
                        />
                      </label>
                    )}
                    <p className="gpu-hint">
                      Mỗi lần cấp một Pod, một GPU vào nhóm. Chọn nhóm hiện có
                      để thêm Pod cùng điều phối; image/model/context giữ theo
                      nhóm.
                    </p>
                  </>
                )}
                {services !== "llm" && (
                  <label>
                    Dữ liệu trên JupyterLab
                    <select
                      value={loadDataset ? "round" : "none"}
                      onChange={(e) =>
                        setLoadDataset(e.target.value === "round")
                      }
                    >
                      <option value="round">
                        Nạp dataset của vòng đã chọn
                      </option>
                      <option value="none">Không nạp dataset</option>
                    </select>
                  </label>
                )}
                <p className="gpu-hint">
                  {services === "llm"
                    ? "Pod chỉ nạp model, không tải dataset hoặc mở JupyterLab. Lịch sử và ngân sách chat tách theo đội."
                    : loadDataset
                      ? "Public được nạp sẵn; private chỉ nạp khi vòng mở private."
                      : "Mở JupyterLab trống. Quyền truy cập vẫn theo lịch vòng đã chọn."}
                </p>
                <label>
                  Giá GPU tối đa chấp nhận (USD/giờ)
                  <input
                    type="number"
                    min={0.01}
                    max={100}
                    step={0.01}
                    value={maxHourlyUsd}
                    onChange={(e) => setMaxHourlyUsd(Number(e.target.value))}
                    required
                  />
                </label>
                <button
                  className="btn primary"
                  disabled={
                    busy ||
                    !state.hasCredential ||
                    (scope === "team" &&
                      (teamOptions.loading ||
                        !eligibleTeams.some((t) => t.id === teamId))) ||
                    (scope === "team" && !teamId) ||
                    !roundId ||
                    !template ||
                    !templateSaved ||
                    hasActive ||
                    !prices
                  }
                >
                  <Cpu size={17} />
                  {teamHub && manualDeploy ? "Chuẩn bị deploy manual" : services === "llm"
                    ? selectedGroup
                      ? "Thêm một Pod vào nhóm"
                      : "Tạo nhóm và cấp Pod đầu tiên"
                    : hasActive
                      ? "Dịch vụ đã có Pod / yêu cầu chờ"
                      : scope === "all"
                        ? "Cấp 1 GPU dùng chung"
                        : "Cấp 1 GPU riêng cho đội"}
                </button>
                {(!prices || !templateSaved) && (
                  <small>Cập nhật giá và lưu template trước khi cấp GPU.</small>
                )}
              </form>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
function Uptime({
  seconds,
  observedAt,
  serverNow,
  running,
}: {
  seconds: number | null;
  observedAt: number | null;
  serverNow: number;
  running: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!running || seconds === null) return;
    const start = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [seconds, observedAt, running, serverNow]);
  const total =
    seconds === null
      ? null
      : Math.floor(
          seconds +
            (running && observedAt
              ? Math.max(0, serverNow - observedAt) / 1000 + elapsed
              : 0),
        );
  return (
    <p className="gpu-hint">
      Uptime:{" "}
      {total === null
        ? "Đang chờ telemetry"
        : `${Math.floor(total / 3600)
            .toString()
            .padStart(2, "0")}:${Math.floor((total / 60) % 60)
            .toString()
            .padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`}
      {!running && total !== null ? " · Pod đã dừng" : ""}
    </p>
  );
}

function WorkspaceCard({
  w,
  observedNow,
  admin,
  canManage,
  retry,
  busy,
  confirm,
  onConfirm,
  onCancel,
  sync,
  control,
  toggleMetrics,
}: {
  w: WorkspaceView;
  observedNow: number;
  admin: boolean;
  canManage: boolean;
  retry: () => void;
  busy: boolean;
  confirm: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  sync: () => void;
  control: (action: string) => void;
  toggleMetrics: () => void;
}) {
  const active = w.status !== "terminated";
  const running = w.status === "running";
  const telemetry = gpuTelemetry(w.health?.gpu);
  return (
    <article
      id={`pod-${w.id}`}
      className={`panel gpu-card ${running ? "gpu-card-running" : ""} ${w.chatGroupId ? "gpu-worker-card" : w.services !== "both" ? "gpu-single-service" : ""}`}
    >
      <div className="gpu-card-main">
        <div className="gpu-card-identity">
          {w.chatGroupId ? (
            <GpuBoard />
          ) : (
            <span
              className={`gpu-chip ${running ? "is-on" : ""}`}
              aria-hidden="true"
            >
              <Cpu size={34} />
            </span>
          )}
          <span className={`pill ${running ? "green" : "neutral"}`}>
            {w.status === "failed" && w.podId
              ? "Lỗi khởi động Pod"
              : w.status === "provisioning" && w.podId
                ? "Container chưa sẵn sàng"
                : statusNames[w.status]}
          </span>
          <h3>{w.template.gpuTypeId}</h3>
          <p>{w.teamName}</p>
          <small>{w.roundTitle}</small>
          <div className="gpu-badges">
            <span className="pill neutral">
              {isTeamHub(w)
                ? "JupyterHub · Team được cấp quyền"
                : w.scope === "all"
                  ? "Dùng chung · Tất cả đội"
                  : "Riêng cho đội"}
            </span>
          </div>
        </div>
        <div className="gpu-telemetry">
          {admin || w.metricsVisible !== false ? (
            <>
              <span className="gpu-telemetry-label">
                <Activity size={15} />
                Thông số GPU
              </span>
              {telemetry ? (
                <dl className="gpu-metric-grid">
                  <div className="gpu-metric-name">
                    <dt>GPU</dt>
                    <dd>{telemetry.name}</dd>
                  </div>
                  <div>
                    <dt>VRAM đang dùng / tổng</dt>
                    <dd>
                      {telemetry.usedMiB !== null && telemetry.totalMiB !== null
                        ? `${(telemetry.usedMiB / 1024).toFixed(1)} / ${(telemetry.totalMiB / 1024).toFixed(1)} GiB`
                        : "Chưa có số liệu"}
                    </dd>
                  </div>
                  <div>
                    <dt>Mức sử dụng GPU</dt>
                    <dd>
                      {telemetry.utilization !== null
                        ? `${telemetry.utilization}%`
                        : "Chưa có số liệu"}
                    </dd>
                  </div>
                  {telemetry.temperature !== null && (
                    <div>
                      <dt>Nhiệt độ</dt>
                      <dd>{telemetry.temperature}°C</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="gpu-metrics">
                  {running ? "Đang chờ dữ liệu từ GPU…" : "GPU chưa hoạt động"}
                </p>
              )}
              <Uptime
                seconds={w.uptimeSeconds ?? null}
                observedAt={w.uptimeObservedAt ?? null}
                serverNow={observedNow}
                running={running}
              />
              <div className="gpu-cost">
                <strong>{money(w.estimatedUsd)}</strong>
                <span>~{money(w.meterRate)}/giờ</span>
              </div>
            </>
          ) : (
            <p className="gpu-hint">
              Quản trị viên đang ẩn thông số tài nguyên GPU.
            </p>
          )}
        </div>
        {!w.chatGroupId && (
          <div
            className={`gpu-service-grid ${w.services !== "both" ? "single-service" : ""}`}
          >
            {hasService(w, "llm") && (
              <ServiceCard
                kind="chat"
                provided={hasService(w, "llm")}
                running={running}
                ready={!!w.health?.llm}
                enabled={!!w.chatbotEnabled}
                detail={
                  w.health?.chatLocked
                    ? "Đã khóa theo giờ của vòng luyện"
                    : w.health?.modelStage
                }
                href={`/workspace/chat?id=${encodeURIComponent(w.id)}`}
              />
            )}
            {hasService(w, "jupyter") && !isTeamHub(w) && (
              <ServiceCard
                kind="jupyter"
                provided={hasService(w, "jupyter")}
                running={running}
                ready={!!w.health?.jupyter}
                enabled={!!w.notebookEnabled}
                href={`/api/workspace/launch?id=${encodeURIComponent(w.id)}`}
              />
            )}
          </div>
        )}
      </div>
      <div className="gpu-card-foot">
        <div className="gpu-card-notes">
          {hasService(w, "jupyter") && w.loadDataset !== false && (
            <span>
              Public: {w.health?.publicReady ? "đã nạp" : "đang chờ"} · Private:{" "}
              {w.health?.privateReady ? "đã nạp" : "đang khóa / chưa nạp"}
            </span>
          )}
          {hasService(w, "jupyter") && w.loadDataset === false && (
            <span>Dataset: không nạp</span>
          )}
          {w.scope === "all" && hasService(w, "jupyter") && !isTeamHub(w) && (
            <span>Các đội dùng chung tệp, kernel và GPU.</span>
          )}
          <small>
            {w.podId ? `Pod ${w.podId}` : "Chưa nhận Pod ID"} ·{" "}
            {w.syncedAt ? `Đối soát ${when(w.syncedAt)}` : "Chưa đối soát"}
          </small>
          {w.chatGroupId && w.health?.modelStage && (
            <span>{w.health.modelStage}</span>
          )}
          {(w.health?.stage || w.accessMessage) && (
            <details className="gpu-status-detail">
              <summary>Chi tiết trạng thái</summary>
              {w.health?.stage && <span>{w.health.stage}</span>}
              {w.accessMessage && <span>{w.accessMessage}</span>}
            </details>
          )}
          {(w.error || w.health?.error) && (
            <span role="status">{w.error ?? w.health?.error}</span>
          )}
        </div>
        {active && (
          <button className="btn small-btn" onClick={sync} disabled={busy}>
            <RefreshCw size={15} />
            Đối soát
          </button>
        )}
      </div>
      {admin &&
        canManage &&
        active &&
        (!w.manual || w.manual.state === "bound") && (
          <div className="gpu-actions">
            {capacityRejected(w) && (
              <button className="btn" disabled={busy} onClick={retry}>
                <RefreshCw size={15} />
                Thử cấp lại GPU
              </button>
            )}
            {running && (
              <button className="btn" disabled={busy} onClick={toggleMetrics}>
                {w.metricsVisible === false
                  ? "Hiện metrics cho đội thi"
                  : "Ẩn metrics với đội thi"}
              </button>
            )}
            {w.podId &&
              ["running", "provisioning", "failed"].includes(w.status) && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => control("stop")}
                >
                  {w.scope === "all" ? "Dừng Pod chung" : "Dừng Pod"}
                </button>
              )}
            {w.status === "stopped" && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => control("start")}
              >
                Chạy lại
              </button>
            )}
            {w.podId && (
              <button className="btn" disabled={busy} onClick={onConfirm}>
                Thu hồi Pod
              </button>
            )}
            {w.status === "failed" && !w.podId && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => control("cancel-failed")}
              >
                Hủy yêu cầu lỗi
              </button>
            )}
          </div>
        )}
      {confirm && (
        <div className="gpu-confirm">
          <p>
            Thu hồi sẽ xóa Pod và volume. Hãy tải mã nguồn, trọng số và thư mục
            bài làm trước khi xác nhận.
            {w.scope === "all" &&
              " Tất cả các đội sẽ mất quyền truy cập Pod dùng chung này."}
          </p>
          <button
            className="btn danger-btn"
            disabled={busy}
            onClick={() => control("terminate")}
          >
            Xác nhận thu hồi
          </button>
          <button className="btn" onClick={onCancel}>
            Quay lại
          </button>
        </div>
      )}
    </article>
  );
}

function ServiceCard({
  kind,
  provided = true,
  running = false,
  ready = false,
  enabled = false,
  href,
  detail,
}: {
  kind: "chat" | "jupyter";
  provided?: boolean;
  running?: boolean;
  ready?: boolean;
  enabled?: boolean;
  href?: string;
  detail?: string;
}) {
  const chat = kind === "chat";
  const title = chat ? "Chatbot" : "JupyterLab";
  const Icon = chat ? MessageSquare : Terminal;
  const status = enabled
    ? "Sẵn sàng"
    : !provided
      ? "Không được cấp"
      : !running
        ? "Đang khóa"
        : ready
          ? "Đang khóa truy cập"
          : "Đang khởi động";
  return (
    <section
      className={`gpu-service-card ${chat ? "service-chat" : "service-jupyter"} ${enabled ? "service-ready" : "service-locked"}`}
    >
      <div className="gpu-service-top">
        <span className="gpu-service-icon">
          <Icon size={23} />
        </span>
        {!enabled && <LockKeyhole size={16} aria-label="Dịch vụ bị khóa" />}
      </div>
      <h4>{title}</h4>
      <p className="gpu-service-description">
        {chat
          ? "Trợ lý DeepSeek · Hỏi đáp & lập trình"
          : "Notebook · Dữ liệu & huấn luyện"}
      </p>
      <span className={`gpu-service-status ${enabled ? "is-ready" : ""}`}>
        <i aria-hidden="true" />
        {status}
      </span>
      <small>
        {!provided
          ? "Dịch vụ không có trên GPU này"
          : detail ||
            (enabled
              ? chat
                ? "Sẵn sàng hỗ trợ đội của bạn"
                : "Mở môi trường làm bài của đội"
              : running
                ? "Chờ dịch vụ sẵn sàng và quyền truy cập"
                : "Khả dụng sau khi GPU được bật và vòng luyện mở")}
      </small>
      {enabled && href ? (
        <a
          className="btn"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Mở {title}
          <ArrowUpRight size={17} />
        </a>
      ) : (
        <button className="btn" disabled>
          <LockKeyhole size={14} />
          {title} đang khóa
        </button>
      )}
    </section>
  );
}

function EmptyWorkspace({
  teamName,
  admin,
}: {
  teamName?: string;
  admin: boolean;
}) {
  return (
    <article className="panel gpu-card gpu-card-empty">
      <div className="gpu-card-main">
        <div className="gpu-card-identity">
          <span className="gpu-chip" aria-hidden="true">
            <Cpu size={34} />
          </span>
          <span className="pill neutral">Chưa bật</span>
          <h3>GPU chưa được cấp</h3>
          <p>
            {teamName ||
              (admin ? "Chưa có phân bổ GPU" : "Workspace của đội bạn")}
          </p>
          <small>
            {admin
              ? "Cấp GPU trong phần cấu hình bên dưới để mở các dịch vụ."
              : teamName
                ? "Chờ quản trị viên cấp GPU cho đội hoặc mở GPU dùng chung."
                : "Tạo hoặc tham gia đội để sử dụng các dịch vụ."}
          </small>
        </div>
        <div className="gpu-telemetry">
          <span className="gpu-telemetry-label">
            <Activity size={15} />
            Thông số GPU
          </span>
          <code className="gpu-metrics">Chưa có GPU hoạt động</code>
          <p className="gpu-hint">
            Thông số và thời gian hoạt động sẽ hiển thị khi GPU được bật.
          </p>
        </div>
        <div className="gpu-service-grid">
          <ServiceCard kind="chat" />
          <ServiceCard kind="jupyter" />
        </div>
      </div>
    </article>
  );
}
