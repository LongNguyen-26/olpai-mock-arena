"use client";
import { useEffect, useState } from "react";
import { api } from "./arena-client";
import type { WorkspaceView } from "@/lib/workspace-domain";
import type { workspaceTeams } from "@/lib/workspace-teams";
import type { manualConfiguration } from "@/lib/hub-service";

const names = {
  stopped: "Đã dừng",
  preparing: "Đang chuẩn bị",
  starting: "Đang khởi động",
  ready: "Sẵn sàng",
  "waiting-resource": "Chờ RAM / dung lượng / chỗ trống",
  error: "Cần kiểm tra",
};
type Run = (fn: () => Promise<unknown>, message: string) => Promise<void>;
export default function JupyterHubPanel({
  w,
  admin,
  teamId,
  busy,
  run,
  refresh,
}: {
  w: WorkspaceView;
  admin: boolean;
  teamId?: string | null;
  busy: boolean;
  run: Run;
  refresh: () => Promise<void>;
}) {
  const [eligible, setEligible] = useState<
    Awaited<ReturnType<typeof workspaceTeams>>["teams"]
  >([]);
  const [selected, setSelected] = useState("");
  const [podId, setPodId] = useState(w.manual?.candidatePodId ?? "");
  const [config, setConfig] = useState<Awaited<
    ReturnType<typeof manualConfiguration>
  > | null>(null);
  const [confirm, setConfirm] = useState("");
  const hub = w.hub,
    canManage = !!hub?.canManage;
  useEffect(() => {
    let alive = true;
    if (canManage)
      void api("workspace/teams", undefined, w.roundId)
        .then((v: Awaited<ReturnType<typeof workspaceTeams>>) => {
          if (alive) setEligible(v.teams);
        })
        .catch(() => {});
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [canManage, w.roundId, refresh]);
  useEffect(() => {
    if (!["prepared", "verifying"].includes(w.manual?.state ?? ""))
      setConfig(null);
  }, [w.manual?.state]);
  function action(
    path: string,
    fields: Record<string, unknown>,
    message: string,
  ) {
    void run(
      () =>
        api(`workspace/${path}`, {
          id: w.id,
          requestId: crypto.randomUUID(),
          ...fields,
        }),
      message,
    );
  }
  const unbound = w.manual && w.manual.state !== "bound";
  return (
    <div className="hub-panel">
      <div className="section-title">
        <h3>JupyterLab riêng từng team</h3>
        <span className="pill neutral">
          {hub?.teams.filter((t) => t.enabled).length ?? 0} team · tối đa{" "}
          {hub?.maxTeamServers ?? 7} server hoạt động
        </span>
      </div>
      <p className="gpu-hint">
        Tệp và kernel tách theo team. Hai máy cùng team cộng tác trực tiếp; GPU
        dùng chung theo nội quy.
      </p>
      {hub?.resources && (
        <p>
          RAM khả dụng: {hub.resources.availableRAMGiB?.toFixed(1) ?? "chưa rõ"}{" "}
          GiB · Ổ đĩa trống:{" "}
          {hub.resources.freeDiskGiB?.toFixed(1) ?? "chưa rõ"} GiB
        </p>
      )}
      {unbound && (
        <div className="alert" role="status">
          {w.manual?.state === "detached"
            ? "Đã gỡ khỏi Arena. Pod và dữ liệu vẫn nằm trên Runpod và có thể tiếp tục tính phí."
            : w.manual?.state === "cancelled"
              ? "Hồ sơ đã hủy. Pod đã deploy ngoài Arena, nếu có, vẫn cần quản lý trên Runpod."
              : "Đang chờ deploy / xác minh Pod thủ công. Chưa tải dataset và chưa tính phí trong Arena."}
        </div>
      )}
      {canManage &&
        ["prepared", "verifying"].includes(w.manual?.state ?? "") && (
          <div className="hub-manual">
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                if (config) setConfig(null);
                else
                  void run(
                    async () =>
                      setConfig(
                        await api(
                          `workspace/manual/config?id=${encodeURIComponent(w.id)}`,
                        ),
                      ),
                    "Chỉ sao chép cấu hình vào Pod của hồ sơ này.",
                  );
              }}
            >
              {config ? "Ẩn cấu hình riêng" : "Xem cấu hình deploy manual"}
            </button>
            {config && (
              <label>
                Cấu hình riêng của admin — có token, không chia sẻ
                <textarea
                  readOnly
                  rows={12}
                  value={JSON.stringify(config, null, 2)}
                  spellCheck={false}
                />
              </label>
            )}
            <label>
              Pod ID
              <input
                value={podId}
                onChange={(e) => setPodId(e.target.value.trim())}
                autoComplete="off"
                placeholder="Nhập ID sau khi deploy Runpod"
              />
            </label>
            <div className="hub-actions">
              <button
                className="btn"
                disabled={busy || !/^[a-zA-Z0-9]{5,64}$/.test(podId)}
                onClick={() =>
                  action(
                    "manual/inspect",
                    { podId },
                    "Đã xác minh danh tính; chưa gắn Pod.",
                  )
                }
              >
                Kiểm tra Pod
              </button>
              <button
                className="btn primary"
                disabled={busy || !/^[a-zA-Z0-9]{5,64}$/.test(podId)}
                onClick={() =>
                  action(
                    "manual/attach",
                    { podId },
                    "Đã gắn Pod. Chờ Hub và dataset sẵn sàng.",
                  )
                }
              >
                Gắn Pod
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => setConfirm("cancel")}
              >
                Hủy hồ sơ
              </button>
            </div>
          </div>
        )}
      {!unbound && (
        <div className="hub-team-list">
          {!hub?.teams.length && (
            <p>Chưa cấp team. Admin có thể thêm team ngay trên Pod này.</p>
          )}
          {hub?.teams.map((t) => (
            <section key={t.teamId} className="hub-team">
              <div>
                <strong>{t.teamName}</strong>
                <span className="pill neutral">
                  {!t.enabled
                    ? "Đã thu hồi quyền"
                    : t.server
                      ? names[t.server.state]
                      : t.desiredState === "running"
                        ? "Chưa có trạng thái mới"
                        : "Đã dừng"}
                </span>
              </div>
              {t.server?.error && <p role="status">{t.server.error}</p>}
              {t.server && w.loadDataset !== false && (
                <small>
                  Public: {t.server.publicReady ? "đã nạp" : "đang nạp"} ·
                  Private:{" "}
                  {t.server.privateReady ? "đã mở" : "đang khóa / chưa nạp"}
                </small>
              )}
              {(canManage || (!admin && teamId === t.teamId)) && t.enabled && (
                <div className="hub-actions">
                  {w.notebookEnabled && (
                    <a
                      className="btn primary"
                      href={`/workspace/hub?id=${encodeURIComponent(w.id)}${admin ? `&teamId=${encodeURIComponent(t.teamId)}` : ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mở JupyterLab của đội
                    </a>
                  )}
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      action(
                        "hub/server",
                        {
                          teamId: t.teamId,
                          action: "start",
                          revision: t.revision,
                        },
                        "Đã yêu cầu khởi động workspace.",
                      )
                    }
                  >
                    Khởi động
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => setConfirm(`stop:${t.teamId}`)}
                  >
                    Dừng workspace
                  </button>
                  {canManage && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => setConfirm(`revoke:${t.teamId}`)}
                    >
                      Thu hồi quyền
                    </button>
                  )}
                </div>
              )}
            </section>
          ))}
          {canManage && (
            <div className="hub-add-team">
              <label>
                Thêm team đã được duyệt
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Chọn team</option>
                  {eligible
                    .filter(
                      (t) =>
                        !hub?.teams.some((n) => n.teamId === t.id && n.enabled),
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="btn"
                disabled={busy || !selected}
                onClick={() =>
                  action(
                    "hub/teams",
                    { teamId: selected, action: "grant" },
                    "Đã cấp quyền. Team tự mở Jupyter khi cần.",
                  )
                }
              >
                Cấp workspace
              </button>
            </div>
          )}
        </div>
      )}
      {!unbound && (
        <section className="hub-gpu-turns">
          <h4>Đăng ký GPU tự quản</h4>
          <p className="gpu-hint">
            Trạng thái do team khai báo. Nhiều team có thể dùng cùng lúc; bảng
            này không chặn CUDA hoặc ngắt job.
          </p>
          <ol>
            {hub?.turns.map((t) => (
              <li key={t.teamId}>
                {t.teamName} — {t.state === "using" ? "đang dùng" : "đang chờ"}
              </li>
            ))}
          </ol>
          {!hub?.turns.length && <p>Chưa có đăng ký.</p>}
          {!admin && teamId && (
            <div className="hub-actions">
              {(
                [
                  ["request", "Xin lượt"],
                  ["start", "Bắt đầu dùng"],
                  ["release", "Trả lượt"],
                  ["cancel", "Hủy đăng ký"],
                ] as const
              ).map(([value, title]) => (
                <button
                  key={value}
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    action(
                      "gpu-turn",
                      { action: value },
                      value === "release"
                        ? "Đã trả lượt. Hãy dừng tiến trình/kernel giữ GPU; nút này không giải phóng VRAM."
                        : "Đã cập nhật đăng ký GPU.",
                    )
                  }
                >
                  {title}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {canManage && w.manual?.state === "bound" && (
        <button
          className="btn"
          disabled={busy}
          onClick={() => setConfirm("detach")}
        >
          Gỡ liên kết Arena
        </button>
      )}
      {confirm && (
        <div className="alert" role="alert">
          <p>
            {confirm === "cancel" || confirm === "detach"
              ? "Thao tác này không dừng hoặc xóa Pod trên Runpod. Pod vẫn có thể tính phí."
              : "Dừng workspace sẽ ngắt kernel và job của riêng team này. Tệp trên volume được giữ."}
          </p>
          <div className="hub-actions">
            <button className="btn" onClick={() => setConfirm("")}>
              Quay lại
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => {
                const [what, target] = confirm.split(":");
                if (what === "stop" || what === "revoke") {
                  const t = hub?.teams.find((n) => n.teamId === target);
                  action(
                    what === "stop" ? "hub/server" : "hub/teams",
                    { action: what, teamId: target, revision: t?.revision },
                    "Đã cập nhật workspace.",
                  );
                } else
                  action(
                    `manual/${what}`,
                    {},
                    "Đã cập nhật liên kết; kiểm tra phí tại Runpod.",
                  );
                setConfirm("");
              }}
            >
              Xác nhận
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
