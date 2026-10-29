"use client";
import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Activity,
  Cpu,
  Fan,
  MessageSquare,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api } from "./arena-client";
import { gpuTelemetry } from "@/lib/gpu-telemetry";
import type { workspaceState } from "@/lib/workspaces";
import type { WorkspaceView } from "@/lib/workspace-domain";

type State = Awaited<ReturnType<typeof workspaceState>>;
type Group = State["chatGroups"][number];
type RunAction = (fn: () => Promise<unknown>, message: string) => Promise<void>;
const usd = (value = 0) => `$${value.toFixed(4)}`;
export function GpuBoard() {
  return (
    <span className="gpu-board" aria-hidden="true">
      <Fan />
      <Cpu />
      <Fan />
      <i />
    </span>
  );
}
function settleJob(id: string, run: RunAction) {
  if (
    !window.confirm(
      "Chốt request chưa xác nhận là thất bại? Chỉ thực hiện sau khi đã đối soát worker; ngân sách đã giữ sẽ không được hoàn.",
    )
  )
    return;
  void run(
    () => api("workspace/job-settle", { requestId: id }),
    "Đã chốt request thất bại.",
  );
}
export default function ChatGroups({
  state,
  admin,
  busy,
  run,
  renderWorkspace,
  onAddPod,
}: {
  state: State;
  admin: boolean;
  busy: boolean;
  run: RunAction;
  renderWorkspace: (workspace: WorkspaceView, canManage: boolean) => ReactNode;
  onAddPod: (group: Group) => void;
}) {
  const [focused, setFocused] = useState<Record<string, string>>({});
  if (!state.chatGroups.length) return null;
  return (
    <section
      className="chat-groups"
      aria-label={admin ? "Nhóm Chatbot" : "Chatbot"}
    >
      <h2>{admin ? "Nhóm Chatbot" : "Chatbot"}</h2>
      {state.chatGroups.map((g) => {
        const allMembers = state.workspaces.filter(
          (w) => w.chatGroupId === g.id,
        );
        const members = allMembers.filter((w) => w.status !== "terminated");
        const selected = members.some((w) => w.id === focused[g.id])
          ? focused[g.id]
          : members[0]?.id;
        const totalCost = admin
          ? g.estimatedUsd
          : allMembers.reduce((sum, w) => sum + w.estimatedUsd, 0);
        const hourly = admin
          ? g.hourlyUsd
          : members.reduce((sum, w) => sum + w.meterRate, 0);
        const showCost =
          admin ||
          (!!members.length &&
            members.every((w) => w.metricsVisible !== false));
        const oldestSeconds =
          g.queue?.oldestQueuedAt == null
            ? null
            : Math.max(
                0,
                Math.floor((state.serverNow - g.queue.oldestQueuedAt) / 1000),
              );
        return (
          <article className="panel chat-group" key={g.id}>
            <header className="chat-group-head">
              <div>
                <span className="chat-eyebrow">
                  <MessageSquare size={15} />
                  {admin ? "Dịch vụ Chatbot" : "Trợ lý DeepSeek"}
                </span>
                <h3>
                  {admin
                    ? g.name
                    : g.scope === "all"
                      ? "Chatbot dùng chung"
                      : "Chatbot của đội"}
                </h3>
                <p>
                  {g.scope === "all"
                    ? "Dành cho tất cả các đội"
                    : "Dành riêng cho đội"}
                  {members[0]?.roundTitle ? ` · ${members[0].roundTitle}` : ""}
                </p>
              </div>
              {admin && (
                <span
                  className={`chat-group-badge ${g.paused ? "is-paused" : ""}`}
                >
                  <i />
                  {g.paused
                    ? "Tạm ngừng nhận prompt"
                    : g.chatbotEnabled
                      ? "Chatbot sẵn sàng"
                      : "Đang chuẩn bị Chatbot"}
                </span>
              )}
            </header>
            <div
              className={`chat-group-overview ${admin ? "" : "is-contestant"}`}
            >
              <a
                className={`chat-launch ${g.chatbotEnabled ? "is-enabled" : "is-locked"}`}
                href={
                  g.chatbotEnabled
                    ? `/workspace/chat?groupId=${encodeURIComponent(g.id)}`
                    : undefined
                }
                aria-disabled={!g.chatbotEnabled}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="chat-launch-icon">
                  <MessageSquare size={27} />
                </span>
                <span>
                  <strong>Mở Chatbot</strong>
                  <small>
                    {g.chatbotEnabled
                      ? "Hỏi đáp, phân tích & lập trình cùng DeepSeek"
                      : "Chatbot sẽ mở khi dịch vụ và vòng luyện sẵn sàng"}
                  </small>
                </span>
                <ArrowUpRight size={23} />
              </a>
              {admin && (
                <div
                  className="chat-group-stats"
                  role="group"
                  aria-label="Tổng quan nhóm"
                >
                  <div className="chat-stat">
                    <span>GPU sẵn sàng</span>
                    <strong>
                      {g.ready ?? 0}
                      <small> / {g.total ?? 0}</small>
                    </strong>
                    <small>Pod trong nhóm</small>
                  </div>
                  <div className="chat-stat is-running">
                    <span>Lượt đang chạy</span>
                    <strong>{g.queue?.running ?? 0}</strong>
                    <small>
                      {g.readySlots ?? g.ready ?? 0} lượt xử lý đồng thời sẵn
                      sàng
                    </small>
                  </div>
                  <div className="chat-stat is-queued">
                    <span>Lượt đang chờ</span>
                    <strong>{g.queue?.queued ?? 0}</strong>
                    <small>
                      {oldestSeconds === null
                        ? "Chưa có lượt chờ"
                        : `Lâu nhất ${oldestSeconds < 60 ? `${oldestSeconds} giây` : `${Math.floor(oldestSeconds / 60)} phút`}`}
                    </small>
                  </div>
                </div>
              )}
            </div>
            <div className="chat-group-toolbar">
              <div className="chat-group-cost">
                {showCost ? (
                  <>
                    <span>Chi phí ước tính</span>
                    <strong>{usd(totalCost)}</strong>
                    <small>{usd(hourly)}/giờ</small>
                  </>
                ) : (
                  <span>Thông số GPU do quản trị viên quản lý</span>
                )}
              </div>
              {admin && (
                <div className="chat-group-actions">
                  <button
                    className="btn small-btn"
                    disabled={busy || !members.length}
                    onClick={() =>
                      void run(
                        () =>
                          Promise.all(
                            members.map((w) =>
                              api("workspace/sync", { id: w.id }),
                            ),
                          ),
                        "Đã đối soát các Pod trong nhóm.",
                      )
                    }
                  >
                    <RefreshCw size={14} />
                    Đối soát nhóm
                  </button>
                  {g.canManage && (
                    <>
                      <button
                        className="btn small-btn"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              api("workspace/group/control", {
                                id: g.id,
                                action: g.paused ? "resume" : "pause",
                              }),
                            "Đã cập nhật tiếp nhận request.",
                          )
                        }
                      >
                        {g.paused ? <Play size={14} /> : <Pause size={14} />}
                        {g.paused
                          ? "Tiếp tục nhận prompt"
                          : "Tạm ngừng nhận prompt mới"}
                      </button>
                      <button
                        className="btn small-btn chat-add-pod"
                        disabled={busy}
                        onClick={() => onAddPod(g)}
                      >
                        <Plus size={15} />
                        Thêm Pod
                      </button>
                      {!members.length && (
                        <button
                          className="btn small-btn"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                api("workspace/group/control", {
                                  id: g.id,
                                  action: "retire",
                                }),
                              "Đã đóng nhóm.",
                            )
                          }
                        >
                          Đóng nhóm
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            {!!members.length && (
              <div className="chat-group-resources">
                <div className="chat-workers-heading">
                  <h4>{admin ? "GPU workers" : "Tài nguyên GPU"}</h4>
                  <span>{members.length} GPU · chọn để xem chi tiết</span>
                </div>
                <div
                  className="chat-worker-selectors"
                  role="group"
                  aria-label="Chọn GPU"
                >
                  {members.map((w, index) => {
                    const telemetry = gpuTelemetry(w.health?.gpu),
                      metrics = admin || w.metricsVisible !== false;
                    return (
                      <button
                        className="chat-worker-selector"
                        key={w.id}
                        aria-pressed={selected === w.id}
                        onClick={() => {
                          setFocused((value) => ({ ...value, [g.id]: w.id }));
                          document
                            .getElementById(`pod-${w.id}`)
                            ?.scrollIntoView({
                              block: "nearest",
                              behavior: window.matchMedia(
                                "(prefers-reduced-motion: reduce)",
                              ).matches
                                ? "instant"
                                : "smooth",
                            });
                        }}
                      >
                        <GpuBoard />
                        <span className="chat-selector-identity">
                          <small>GPU {index + 1}</small>
                          <strong>
                            {w.template.gpuTypeId.replace(/^NVIDIA /, "")}
                          </strong>
                          <span>Pod {w.podId ?? "chưa được cấp"}</span>
                        </span>
                        {metrics && (
                          <span className="chat-selector-metrics">
                            <span>
                              GPU{" "}
                              <b>
                                {telemetry?.utilization != null
                                  ? `${telemetry.utilization}%`
                                  : "—"}
                              </b>
                            </span>
                            <span>
                              VRAM{" "}
                              <b>
                                {telemetry?.usedMiB != null
                                  ? `${(telemetry.usedMiB / 1024).toFixed(1)} GiB`
                                  : "—"}
                              </b>
                            </span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="chat-group-members">
                  {members.map((w) => (
                    <div
                      className={
                        selected === w.id
                          ? "chat-member is-selected"
                          : "chat-member"
                      }
                      key={w.id}
                    >
                      {renderWorkspace(w, g.canManage)}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!members.length && (
              <p className="chat-group-empty">
                {admin
                  ? "Chưa có GPU hoạt động. Thêm Pod vào nhóm để cung cấp Chatbot."
                  : "Quản trị viên đang chuẩn bị tài nguyên cho Chatbot."}
              </p>
            )}
            {admin &&
              g.queue?.uncertain.map((j) => (
                <div className="alert chat-uncertain" key={j.id}>
                  <span>Request cần đối soát · {j.id.slice(0, 8)}</span>
                  {g.canManage && (
                    <button
                      className="btn small-btn"
                      disabled={busy}
                      onClick={() => settleJob(j.id, run)}
                    >
                      Chốt thất bại sau đối soát
                    </button>
                  )}
                </div>
              ))}
          </article>
        );
      })}
    </section>
  );
}
export function ChatWorkerOperations({
  state,
  busy,
  run,
}: {
  state: State;
  busy: boolean;
  run: RunAction;
}) {
  if (!state.chatOperations.length) return null;
  const online = state.chatOperations.filter(
    (op) => op.worker && state.serverNow - op.worker.heartbeatAt < 45000,
  ).length;
  return (
    <section className="panel chat-operations" aria-label="Điều phối Chatbot">
      <header className="chat-ops-head">
        <div>
          <span className="chat-eyebrow">
            <Network size={15} />
            Vận hành
          </span>
          <h2>Điều phối worker</h2>
          <p>Quản lý nhận việc và theo dõi kết nối của từng GPU.</p>
        </div>
        <span className="chat-ops-online">
          <Activity size={15} />
          {online}/{state.chatOperations.length} worker kết nối
        </span>
      </header>
      <div className="chat-ops-list">
        {state.chatOperations.map((op) => {
          const w = state.workspaces.find((w) => w.id === op.id),
            group = state.chatGroups.find((g) => g.id === op.groupId);
          const fresh =
            !!op.worker && state.serverNow - op.worker.heartbeatAt < 45000;
          const compatible =
            (op.worker?.protocol === 1 || op.worker?.protocol === 2) &&
            (!w || op.worker.runId === w.runId);
          const available =
            fresh && compatible && op.worker?.ready && !op.draining;
          const label = op.draining
            ? "Đã ngừng giao việc mới"
            : !fresh
              ? "Chưa có kết nối"
              : !compatible
                ? "Cần cập nhật worker"
                : available
                  ? "Sẵn sàng nhận việc"
                  : "Chờ model sẵn sàng";
          return (
            <article className="chat-operation" key={op.id}>
              <div className="chat-operation-identity">
                <span className="chat-op-icon">
                  <Cpu size={21} />
                </span>
                <div>
                  <strong>Pod {w?.podId ?? op.id.slice(0, 8)}</strong>
                  <span>
                    {w?.template.gpuTypeId ?? "GPU worker"} ·{" "}
                    {group?.name ?? "Chatbot độc lập"}
                  </span>
                </div>
              </div>
              <div className="chat-operation-state">
                <span
                  className={`chat-worker-status ${available ? "is-ready" : ""}`}
                >
                  <i />
                  {label}
                </span>
                <small>
                  {op.worker
                    ? `Heartbeat ${new Date(op.worker.heartbeatAt).toLocaleTimeString("vi-VN")} · ${Math.max(0, Math.floor((state.serverNow - op.worker.heartbeatAt) / 1000))} giây trước · Giao thức ${op.worker.protocol}`
                    : "Đợi worker kết nối với hệ thống"}
                </small>
                {op.queue && (
                  <small>
                    {op.queue.running} lượt chạy · {op.queue.queued} lượt chờ ·{" "}
                    {op.worker?.capacity ?? 1} lượt đồng thời / GPU
                  </small>
                )}
              </div>
              {op.canManage ? (
                <button
                  className="btn small-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        api("workspace/worker-drain", {
                          id: op.id,
                          draining: !op.draining,
                        }),
                      "Đã cập nhật giao việc cho Pod.",
                    )
                  }
                >
                  {op.draining ? <Play size={14} /> : <Pause size={14} />}
                  {op.draining ? "Tiếp tục giao việc" : "Ngừng giao việc mới"}
                </button>
              ) : (
                <span className="chat-owner-note">
                  <ShieldCheck size={14} />
                  Quản trị viên khác quản lý
                </span>
              )}
              {op.queue?.uncertain.map((j) => (
                <button
                  className="btn small-btn"
                  key={j.id}
                  disabled={busy || !op.canManage}
                  onClick={() => settleJob(j.id, run)}
                >
                  Đối soát {j.id.slice(0, 8)}
                </button>
              ))}
            </article>
          );
        })}
      </div>
      <p className="chat-ops-note">
        Ngừng giao việc mới vẫn cho phép lượt hiện tại hoàn tất trước khi dừng
        Pod.
      </p>
    </section>
  );
}
