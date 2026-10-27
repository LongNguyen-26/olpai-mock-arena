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
    [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState(""),
    [template, setTemplate] = useState<WorkspaceTemplate | null>(null),
    [teamId, setTeamId] = useState(""),
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
  // Contestant's own Pod is refreshed automatically. Admin can reconcile each allocation explicitly.
  useEffect(() => {
    if (data.user.admin) return;
    const id = state?.workspaces.find(
      (w) => !["terminated", "failed"].includes(w.status),
    )?.id;
    if (!id) return;
    let active = true;
    const refresh = async () => {
      try {
        await api("workspace/sync", { id });
        if (active) await load();
      } catch {
        /* The saved status and last sync time remain visible. */
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    data.user.admin,
    state?.workspaces.find((w) => !["terminated", "failed"].includes(w.status))
      ?.id,
    load,
  ]);
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
    (w) => w.teamId === teamId && w.status !== "terminated",
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
          <h2>Một GPU. Cả đội cùng làm bài.</h2>
          <p>
            Chatbot DeepSeek 32B và JupyterLab dùng chung GPU của đội. Mỗi phiên
            chat mặc định 2.000 token input + output; chatbot khóa khi chuyển
            sang private.
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
                Cấp GPU cho đội
              </h2>
              <p>
                Mặc định A40 48 GB + DeepSeek Q4_K_M (~19,9 GB trọng số). VRAM
                còn lại và tốc độ thực tế phụ thuộc cả notebook đang chạy.
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
                    6 giờ: {money(hourly * 6)} / đội, cộng phí lưu trữ và thuế.
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
                        teamId,
                        roundId,
                        templateId: template.id,
                        maxHourlyUsd,
                      }),
                    "Đã ghi nhận yêu cầu. Đối soát để cập nhật trạng thái Pod.",
                  );
                }}
              >
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
                    Chưa có đội. Thí sinh cần tạo đội trước khi admin cấp GPU.
                  </p>
                )}
                <label>
                  Dataset của vòng luyện
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
                  Agent tải public từ Drive/Blob và đối chiếu SHA-256. Private
                  chỉ được tải sau khi vòng thi mở private. Khóa theo cùng lượt
                  thi; đặt lại vòng cần thu hồi và cấp workspace mới.
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
                    !teamId ||
                    !roundId ||
                    !template ||
                    !templateSaved ||
                    hasActive ||
                    !prices
                  }
                >
                  <Cpu size={17} />
                  {hasActive ? "Đội đã có yêu cầu / Pod" : "Cấp 1 GPU cho đội"}
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
                  : "Admin cấp Pod theo đội. Hai máy dùng chung workspace và GPU."}
              </p>
            </section>
          )}
          <div className="gpu-card-grid">
            {state.workspaces.map((w) => (
              <WorkspaceCard
                key={w.id}
                w={w}
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
function WorkspaceCard({
  w,
  admin,
  busy,
  confirm,
  onConfirm,
  onCancel,
  sync,
  control,
}: {
  w: WorkspaceView;
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
      <div className="gpu-services">
        <span className={w.health?.jupyter ? "is-ready" : ""}>
          ● JupyterLab {w.health?.jupyter ? "sẵn sàng" : "chưa sẵn sàng"}
        </span>
        <span className={w.health?.llm ? "is-ready" : ""}>
          ● DeepSeek{" "}
          {w.health?.chatLocked
            ? "đã khóa theo giờ"
            : w.health?.llm
              ? "sẵn sàng"
              : "chưa sẵn sàng"}
        </span>
        <span>
          Public: {w.health?.publicReady ? "đã nạp" : "đang chờ"} · Private:{" "}
          {w.health?.privateReady ? "đã mở và nạp" : "đang khóa / chưa nạp"}
        </span>
      </div>
      {w.health?.gpu && <code className="gpu-metrics">{w.health.gpu}</code>}
      {w.health?.stage && <p>{w.health.stage}</p>}
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
        <a
          className={`btn primary ${w.status !== "running" ? "disabled-link" : ""}`}
          href={`/workspace/chat?id=${w.id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Chatbot
          <ExternalLink size={15} />
        </a>
        <a
          className={`btn ${w.status !== "running" || !w.health?.jupyter ? "disabled-link" : ""}`}
          href={`/api/workspace/launch?id=${w.id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          JupyterLab
          <ExternalLink size={15} />
        </a>
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
              Dừng Pod
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
