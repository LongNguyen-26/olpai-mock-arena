"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Cpu,
  ExternalLink,
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
    [confirmId, setConfirmId] = useState("");
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
  return (
    <div className="gpu-workspace">
      <section className="panel gpu-intro">
        <div className="gpu-intro-icon">
          <Cpu size={30} />
        </div>
        <div>
          <span className="eyebrow">TEAM COMPUTE</span>
          <h2>GPU chung hoặc riêng. Dịch vụ theo nhu cầu.</h2>
          <p>
            Dùng Pod của đội và Pod chung trên cùng một trang. Mỗi Pod có thể
            chạy Chatbot, JupyterLab hoặc cả hai; Chatbot mở theo giờ public của
            vòng luyện.
          </p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={16} />
          Làm mới
        </button>
      </section>
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
      {state && (
        <section className="gpu-allocations">
          <div className="section-title">
            <h2>{data.user.admin ? "GPU của các đội" : "GPU của đội bạn"}</h2>
            <span>
              Ước tính tổng{" "}
              {money(state.workspaces.reduce((n, w) => n + w.estimatedUsd, 0))}
            </span>
          </div>
          {!state.workspaces.length && (
            <section className="panel gpu-empty">
              <Terminal size={32} />
              <h3>
                {data.team || data.user.admin
                  ? "Chưa có GPU được cấp"
                  : "Tạo hoặc tham gia đội để dùng GPU"}
              </h3>
              <p>
                {data.user.admin
                  ? "Các yêu cầu cấp phát và chi phí sẽ xuất hiện tại đây."
                  : "Pod riêng của đội và Pod chung sẽ xuất hiện tại đây."}
              </p>
            </section>
          )}
          {(["all", "team"] as const).map((group) => {
            const items = state.workspaces.filter((w) => w.scope === group);
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
  return (
    <article className="panel gpu-card">
      <div className="section-title">
        <h3>{w.teamName}</h3>
        <span
          className={`pill ${w.status === "running" ? "green" : "neutral"}`}
        >
          {statusNames[w.status]}
        </span>
      </div>
      <p>
        {w.roundTitle} · {w.template.gpuTypeId}
      </p>
      <div className="gpu-badges">
        <span className="pill neutral">
          {w.scope === "all" ? "Dùng chung · Tất cả đội" : "Riêng cho đội"}
        </span>
        <span className="pill neutral">
          {serviceOptions.find((s) => s.id === w.services)?.label}
        </span>
      </div>
      {w.scope === "all" && hasService(w, "jupyter") && (
        <p className="gpu-hint">
          Các đội dùng chung tệp, kernel và GPU của JupyterLab này.
        </p>
      )}
      <div className="gpu-services">
        {hasService(w, "jupyter") && (
          <span className={w.health?.jupyter ? "is-ready" : ""}>
            ● JupyterLab {w.health?.jupyter ? "sẵn sàng" : "chưa sẵn sàng"}
          </span>
        )}
        {hasService(w, "llm") && (
          <span className={w.health?.llm ? "is-ready" : ""}>
            ● DeepSeek{" "}
            {w.health?.chatLocked
              ? "đã khóa theo giờ"
              : w.health?.llm
                ? "sẵn sàng"
                : "chưa sẵn sàng"}
          </span>
        )}
        {hasService(w, "jupyter") && (
          <span>
            Public: {w.health?.publicReady ? "đã nạp" : "đang chờ"} · Private:{" "}
            {w.health?.privateReady ? "đã mở và nạp" : "đang khóa / chưa nạp"}
          </span>
        )}
      </div>
      {w.health?.gpu && <code className="gpu-metrics">{w.health.gpu}</code>}
      {w.health?.stage && <p>{w.health.stage}</p>}
      {hasService(w, "llm") && w.health?.modelStage && (
        <p>{w.health.modelStage}</p>
      )}
      {(w.error || w.health?.error) && (
        <p role="status" className="gpu-hint">
          {w.error ?? w.health?.error}
        </p>
      )}
      <div className="gpu-cost">
        <strong>{money(w.estimatedUsd)}</strong>
        <span>~{money(w.meterRate)}/giờ hiện tại</span>
      </div>
      <small>
        {w.podId ? `Pod ${w.podId}` : "Chưa nhận Pod ID"} ·{" "}
        {w.syncedAt ? `Đối soát ${when(w.syncedAt)}` : "Chưa đối soát"}
      </small>
      <div className="gpu-actions">
        <Uptime
          seconds={w.uptimeSeconds ?? null}
          observedAt={w.uptimeObservedAt ?? null}
          serverNow={observedNow}
          running={w.status === "running"}
        />
      </div>
      {w.accessMessage && (
        <p role="status" className="gpu-hint">
          {w.accessMessage}
        </p>
      )}
      <div className="gpu-actions">
        {hasService(w, "llm") && (
          <a
            className={`btn primary ${!w.chatbotEnabled ? "disabled-link" : ""}`}
            href={w.chatbotEnabled ? `/workspace/chat?id=${w.id}` : undefined}
            aria-disabled={!w.chatbotEnabled}
            tabIndex={w.chatbotEnabled ? undefined : -1}
            target="_blank"
            rel="noopener noreferrer"
          >
            Chatbot
            <ExternalLink size={15} />
          </a>
        )}
        {hasService(w, "jupyter") && (
          <a
            className={`btn ${!w.notebookEnabled ? "disabled-link" : ""}`}
            href={
              w.notebookEnabled ? `/api/workspace/launch?id=${w.id}` : undefined
            }
            aria-disabled={!w.notebookEnabled}
            tabIndex={w.notebookEnabled ? undefined : -1}
            target="_blank"
            rel="noopener noreferrer"
          >
            JupyterLab
            <ExternalLink size={15} />
          </a>
        )}
        {active && (
          <button className="btn" onClick={sync} disabled={busy}>
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
