"use client";
import { api } from "./arena-client";
import type { workspaceState } from "@/lib/workspaces";
type State = Awaited<ReturnType<typeof workspaceState>>;
export default function ChatGroups({
  state,
  admin,
  busy,
  run,
}: {
  state: State;
  admin: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const settle = (id: string) => {
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
  };
  return (
    <>
      {!!state.chatGroups.length && (
        <section className="gpu-allocation-group" aria-label="Nhóm Chatbot">
          <h2>Nhóm Chatbot</h2>
          <div className="gpu-card-grid">
            {state.chatGroups.map((g) => (
              <article key={g.id} className="panel gpu-panel">
                <h3>{g.name}</h3>
                <p>
                  {g.scope === "all" ? "Chung tất cả đội" : "Riêng một đội"}
                </p>
                <a
                  className={`btn primary ${!g.chatbotEnabled ? "disabled" : ""}`}
                  href={
                    g.chatbotEnabled
                      ? `/workspace/chat?groupId=${encodeURIComponent(g.id)}`
                      : undefined
                  }
                  aria-disabled={!g.chatbotEnabled}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Mở Chatbot
                </a>
                {admin && (
                  <>
                    <ul>
                      {g.workspaceIds?.map((id) => {
                        const w = state.workspaces.find((w) => w.id === id);
                        return w && w.status !== "terminated" ? (
                          <li key={id}>
                            <button
                              className="btn"
                              onClick={() =>
                                document
                                  .getElementById(`pod-${id}`)
                                  ?.scrollIntoView({
                                    block: "center",
                                    behavior: "smooth",
                                  })
                              }
                            >
                              Pod {w.podId ?? id.slice(0, 8)}
                            </button>{" "}
                            · {w.template.gpuTypeId} · $
                            {w.estimatedUsd.toFixed(4)}
                          </li>
                        ) : null;
                      })}
                    </ul>
                    <p>
                      {g.ready}/{g.total} Pod sẵn sàng · {g.queue?.running ?? 0}{" "}
                      lượt đang chạy · {g.queue?.queued ?? 0} lượt đang chờ
                    </p>
                    <p>
                      Chi phí nhóm: ${g.estimatedUsd?.toFixed(4)} · $
                      {g.hourlyUsd?.toFixed(4)}/giờ
                    </p>
                    {g.queue?.oldestQueuedAt != null && (
                      <p>
                        Lượt chờ lâu nhất từ{" "}
                        {new Date(g.queue.oldestQueuedAt).toLocaleTimeString(
                          "vi-VN",
                        )}
                      </p>
                    )}
                    {g.canManage && (
                      <div className="gpu-actions">
                        <button
                          className="btn"
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
                          {g.paused
                            ? "Tiếp tục nhận prompt"
                            : "Tạm ngừng nhận prompt mới"}
                        </button>
                        <button
                          className="btn"
                          disabled={busy || !!g.total}
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
                          Đóng nhóm đã thu hồi hết Pod
                        </button>
                      </div>
                    )}
                    {g.queue?.uncertain.map((j) => (
                      <div className="alert" key={j.id}>
                        Request cần đối soát · {j.id.slice(0, 8)}{" "}
                        {g.canManage && (
                          <button
                            className="btn"
                            disabled={busy}
                            onClick={() => settle(j.id)}
                          >
                            Chốt thất bại sau đối soát
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {admin && !!state.chatOperations.length && (
        <section className="panel gpu-panel" aria-label="Điều phối Chatbot">
          <h3>Điều phối worker</h3>
          {state.chatOperations.map((w) => (
            <div className="chat-worker-row" key={w.id}>
              <div>
                <strong>Pod {w.id.slice(0, 8)}</strong>
                <p>
                  {w.worker
                    ? `Giao thức ${w.worker.protocol} · heartbeat ${new Date(w.worker.heartbeatAt).toLocaleTimeString("vi-VN")}`
                    : "Chưa có worker hàng đợi tương thích"}
                  {w.queue &&
                    ` · ${w.queue.running} chạy / ${w.queue.queued} chờ`}
                </p>
              </div>
              {w.canManage && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        api("workspace/worker-drain", {
                          id: w.id,
                          draining: !w.draining,
                        }),
                      "Đã cập nhật giao việc cho Pod.",
                    )
                  }
                >
                  {w.draining ? "Tiếp tục giao việc" : "Ngừng giao việc mới"}
                </button>
              )}
              {w.queue?.uncertain.map((j) => (
                <button
                  className="btn"
                  key={j.id}
                  disabled={busy || !w.canManage}
                  onClick={() => settle(j.id)}
                >
                  Đối soát {j.id.slice(0, 8)}
                </button>
              ))}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
