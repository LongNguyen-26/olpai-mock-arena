"use client";
import { useCallback, useEffect, useState } from "react";
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
const priceOf = (g: GpuPrice | undefined, t: WorkspaceTemplate | null) =>
  g?.price[t?.cloudType === "SECURE" ? "secure" : "community"];
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
    [services, setServices] = useState<WorkspaceServices>("both"),
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
  const load = useCallback(async () => {
    try {
      const next: State = await api("workspace/state");
      setState(next);
      setTemplate((t) => t ?? next.templates[0] ?? next.defaultTemplate);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);
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
      .filter((w) => !["terminated", "failed"].includes(w.status))
      .map((w) => w.id)
      .join(",") ?? "";
  // Refresh shared and private Pods, not just the first allocation.
  useEffect(() => {
    if (data.user.admin) return;
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
  }, [data.user.admin, syncIds, load]);
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
    setTemplate((t) => (t ? { ...t, [field]: value } : t));
  }
  const chosen = prices?.gpus.find((g) => g.id === template?.gpuTypeId),
    hourly = priceOf(chosen, template);
  const hasActive = state?.workspaces.some(
    (w) =>
      w.scope === scope &&
      (scope === "all" || w.teamId === teamId) &&
      w.roundId === roundId &&
      servicesOverlap(w.services, services) &&
      w.status !== "terminated",
  );
  const templateSaved =
    !!template &&
    !!state?.templates.some(
      (t) =>
        t.id === template.id &&
        Object.entries(template).every(
          ([field, value]) => Reflect.get(t, field) === value,
        ),
    );
  const current =
    state?.workspaces.filter((w) => w.status !== "terminated") ?? [];
  const history =
    state?.workspaces.filter((w) => w.status === "terminated") ?? [];
  const visibleWorkspaces = allocationTab === "current" ? current : history;
  return (
    <div className="gpu-workspace">
      <div className="gpu-workspace-head">
        <div>
          <p>Truy cập Chatbot và JupyterLab của đội tại đây.</p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={16} />
          Làm mới
        </button>
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
      {notice && (
        <div className="alert success" role="status">
          {notice}
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
            <span>
              Ước tính tổng{" "}
              {money(state.workspaces.reduce((n, w) => n + w.estimatedUsd, 0))}
            </span>
          </div>
          {allocationTab === "current" && !current.length && (
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
                  {items.map((w) => (
                    <WorkspaceCard
                      key={w.id}
                      w={w}
                      observedNow={state.serverNow}
                      admin={data.user.admin}
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
                    />
                  ))}
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
          <div className="gpu-admin-grid">
            <section className="panel gpu-panel">
              <h2>Template môi trường</h2>
              {template && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(
                      () => api("workspace/template", template),
                      "Đã lưu template để dùng cho các đội.",
                    );
                  }}
                >
                  <label>
                    Template đã lưu
                    <select
                      value={
                        state.templates.some((t) => t.id === template.id)
                          ? template.id
                          : ""
                      }
                      onChange={(e) => {
                        const t = state.templates.find(
                          (t) => t.id === e.target.value,
                        );
                        if (t) setTemplate(t);
                      }}
                    >
                      <option value="" disabled>
                        Cấu hình mới
                      </option>
                      {state.templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="gpu-form-grid">
                    <label>
                      Tên template
                      <input
                        value={template.name}
                        maxLength={80}
                        onChange={(e) => edit("name", e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Cloud
                      <select
                        value={template.cloudType}
                        onChange={(e) =>
                          edit(
                            "cloudType",
                            e.target.value as "COMMUNITY" | "SECURE",
                          )
                        }
                      >
                        <option value="COMMUNITY">Community · tiết kiệm</option>
                        <option value="SECURE">Secure</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    GPU
                    <select
                      value={template.gpuTypeId}
                      onChange={(e) => edit("gpuTypeId", e.target.value)}
                    >
                      {!prices?.gpus.some(
                        (g) => g.id === template.gpuTypeId,
                      ) && (
                        <option value={template.gpuTypeId}>
                          {template.gpuTypeId}
                        </option>
                      )}
                      {prices?.gpus.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} · {g.memory} GB
                          {g.price[
                            template.cloudType === "SECURE"
                              ? "secure"
                              : "community"
                          ] != null
                            ? ` · ${money(g.price[template.cloudType === "SECURE" ? "secure" : "community"]!)}/h`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Docker image / digest
                    <input
                      value={template.imageName}
                      placeholder="nguyenlong26/olpai-workspace:2026.10.27"
                      onChange={(e) => edit("imageName", e.target.value)}
                      required
                    />
                    <small>
                      Image cần được build và push trước khi cấp Pod. Xem
                      docs/GPU_WORKSPACE.md.
                    </small>
                  </label>
                  <div className="gpu-form-grid">
                    {(
                      [
                        ["minRAMPerGPU", "RAM tối thiểu (GB)"],
                        ["minVCPUPerGPU", "vCPU tối thiểu"],
                        ["containerDiskInGb", "Container disk (GB)"],
                        ["volumeInGb", "Workspace volume (GB)"],
                        ["sessionTokenLimit", "Tổng token mỗi phiên"],
                        ["inputTokenLimit", "Input tối đa / lượt"],
                        ["outputTokenLimit", "Output tối đa / lượt"],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field}>
                        {label}
                        <input
                          type="number"
                          value={template[field]}
                          min={1}
                          step={1}
                          required
                          onChange={(e) => edit(field, Number(e.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="gpu-actions">
                    <button className="btn primary" disabled={busy}>
                      <Save size={16} />
                      Lưu template
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setTemplate({
                          ...template,
                          id: crypto.randomUUID(),
                          name: `${template.name} (bản sao)`.slice(0, 80),
                        })
                      }
                      disabled={busy}
                    >
                      Tạo bản sao
                    </button>
                  </div>
                </form>
              )}
            </section>
            <section className="panel gpu-panel">
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
                  void run(
                    () =>
                      api("workspace/deploy", {
                        teamId: scope === "team" ? teamId : null,
                        scope,
                        services,
                        roundId,
                        templateId: template.id,
                        maxHourlyUsd,
                      }),
                    "Đã ghi nhận yêu cầu. Đối soát để cập nhật trạng thái Pod.",
                  );
                }}
              >
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
                <fieldset className="gpu-choices">
                  <legend>Dịch vụ trên Pod</legend>
                  <div className="gpu-choice-grid gpu-choice-services">
                    {serviceOptions.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        aria-pressed={services === mode.id}
                        onClick={() => setServices(mode.id)}
                      >
                        <strong>{mode.label}</strong>
                        <span>{mode.description}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                {scope === "all" && (
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
                {scope === "team" && (
                  <>
                    <label>
                      Đội thi
                      <select
                        required
                        value={teamId}
                        onChange={(e) => setTeamId(e.target.value)}
                      >
                        <option value="">Chọn đội đã được tạo</option>
                        {state.teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} · {t.members} thành viên
                          </option>
                        ))}
                      </select>
                    </label>
                    {!state.teams.length && (
                      <p>
                        Chưa có đội. Thí sinh cần tạo đội trước khi admin cấp
                        GPU.
                      </p>
                    )}
                  </>
                )}
                <label>
                  {services === "llm"
                    ? "Vòng luyện áp dụng giờ Chatbot"
                    : "Dataset và lịch của vòng luyện"}
                  <select
                    value={roundId}
                    required
                    onChange={(e) => setRoundId(e.target.value)}
                  >
                    <option value="">Chọn vòng luyện</option>
                    {data.rounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                        {r.id === data.contest?.roundId
                          ? " · vòng đang xem (gợi ý)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="gpu-hint">
                  {services === "llm"
                    ? "Pod chỉ nạp model, không tải dataset hoặc mở JupyterLab. Lịch sử và ngân sách chat tách theo đội."
                    : "Nạp dataset public của vòng đã chọn; private chỉ tải khi mở private. Reset vòng tự gắn lượt mới, giữ Pod và tệp."}
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
                    (scope === "team" && !teamId) ||
                    !roundId ||
                    !template ||
                    !templateSaved ||
                    hasActive ||
                    !prices
                  }
                >
                  <Cpu size={17} />
                  {hasActive
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
  busy,
  confirm,
  onConfirm,
  onCancel,
  sync,
  control,
}: {
  w: WorkspaceView;
  observedNow: number;
  admin: boolean;
  busy: boolean;
  confirm: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  sync: () => void;
  control: (action: string) => void;
}) {
  const active = w.status !== "terminated";
  const running = w.status === "running";
  return (
    <article className={`panel gpu-card ${running ? "gpu-card-running" : ""}`}>
      <div className="gpu-card-main">
        <div className="gpu-card-identity">
          <span
            className={`gpu-chip ${running ? "is-on" : ""}`}
            aria-hidden="true"
          >
            <Cpu size={34} />
          </span>
          <span className={`pill ${running ? "green" : "neutral"}`}>
            {statusNames[w.status]}
          </span>
          <h3>{w.template.gpuTypeId}</h3>
          <p>{w.teamName}</p>
          <small>{w.roundTitle}</small>
          <div className="gpu-badges">
            <span className="pill neutral">
              {w.scope === "all" ? "Dùng chung · Tất cả đội" : "Riêng cho đội"}
            </span>
          </div>
        </div>
        <div className="gpu-telemetry">
          <span className="gpu-telemetry-label">
            <Activity size={15} />
            Thông số GPU
          </span>
          <code className="gpu-metrics">
            {w.health?.gpu ||
              (running ? "Đang chờ dữ liệu từ GPU…" : "GPU chưa hoạt động")}
          </code>
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
        </div>
        <div className="gpu-service-grid">
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
          <ServiceCard
            kind="jupyter"
            provided={hasService(w, "jupyter")}
            running={running}
            ready={!!w.health?.jupyter}
            enabled={!!w.notebookEnabled}
            href={`/api/workspace/launch?id=${encodeURIComponent(w.id)}`}
          />
        </div>
      </div>
      <div className="gpu-card-foot">
        <div className="gpu-card-notes">
          {hasService(w, "jupyter") && (
            <span>
              Public: {w.health?.publicReady ? "đã nạp" : "đang chờ"} · Private:{" "}
              {w.health?.privateReady ? "đã nạp" : "đang khóa / chưa nạp"}
            </span>
          )}
          {w.scope === "all" && hasService(w, "jupyter") && (
            <span>Các đội dùng chung tệp, kernel và GPU.</span>
          )}
          <small>
            {w.podId ? `Pod ${w.podId}` : "Chưa nhận Pod ID"} ·{" "}
            {w.syncedAt ? `Đối soát ${when(w.syncedAt)}` : "Chưa đối soát"}
          </small>
          {w.health?.stage && <span>{w.health.stage}</span>}
          {w.accessMessage && <span role="status">{w.accessMessage}</span>}
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
      {admin && active && (
        <div className="gpu-actions">
          {w.status === "running" && (
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
            Final trước khi xác nhận.
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
