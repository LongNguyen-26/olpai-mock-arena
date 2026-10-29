"use client";
import { useEffect, useState } from "react";
import {
  Clock3,
  Play,
  Plus,
  ShieldCheck,
  Bell,
  ArrowDownToLine,
} from "lucide-react";
import { api, when, type ViewProps } from "./arena-client";
import { phaseOf, privateStart, contestEnd } from "@/lib/domain";
import RoundVisibilityButton from "./round-visibility-button";
import RoundAccessControls from "./round-access-controls";
export default function RoundAdmin({ data, busy, action }: ViewProps) {
  const c = data.contest;
  if (!c) return null;
  const phase = phaseOf(c, data.serverNow),
    open = ["public", "private", "practice"].includes(phase),
    waiting = ["waiting", "scheduled"].includes(phase),
    p = privateStart(c),
    end = contestEnd(c);
  return (
    <div className="round-admin-layout">
      <section className="panel round-control-panel">
        <div className="section-title">
          <h2>
            <Play size={19} />
            Điều khiển vòng luyện
          </h2>
          <div className="round-control-status">
            <span className="pill neutral">
              {open ? "Đang mở" : phase === "ended" ? "Đã kết thúc" : "Chưa mở"}
            </span>
            <RoundVisibilityButton
              hidden={!!c.hidden}
              title={c.title}
              busy={busy}
              onChange={(hidden) =>
                void action(
                  "admin/control",
                  { action: "visibility", hidden },
                  hidden ? "Đã ẩn vòng luyện." : "Đã hiển thị vòng luyện.",
                )
              }
            />
          </div>
        </div>
        {c.hidden && (
          <p className="round-visibility-note">
            Vòng đang ẩn với thí sinh. Dữ liệu và kết quả được giữ lại.
          </p>
        )}
        <div className="round-control-body">
          <dl className="round-times round-time-grid">
            <div>
              <dt>{c.practice ? "Bắt đầu luyện tập" : "Bắt đầu"}</dt>
              <dd>
                {c.practice
                  ? when(c.practice.startAt)
                  : c.startAt
                    ? when(c.startAt)
                    : "Chưa đặt"}
              </dd>
            </div>
            <div>
              <dt>Mở private</dt>
              <dd>
                {c.practice
                  ? "Mở cùng luyện tập"
                  : p
                    ? when(p)
                    : c.unlimited
                      ? "Do quản trị viên mở"
                      : "Chưa đặt"}
              </dd>
            </div>
            <div>
              <dt>Kết thúc</dt>
              <dd>
                {end
                  ? when(end)
                  : c.unlimited || c.practice || open
                    ? "Không giới hạn"
                    : "Chưa đặt"}
              </dd>
            </div>
          </dl>
          <div className="round-control-tools">
            <div className="action-row round-control-actions">
              {waiting && (
                <button
                  className="btn primary"
                  disabled={busy || !data.ready}
                  onClick={() => {
                    if (confirm("Mở đề và public test cho người đã đăng ký?"))
                      void action(
                        "admin/control",
                        { action: "start" },
                        "Đã bắt đầu vòng luyện.",
                      );
                  }}
                >
                  <Play size={16} />
                  Bắt đầu ngay
                </button>
              )}
              {phase === "scheduled" && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => action("admin/control", { action: "cancel" })}
                >
                  Hủy lịch hẹn
                </button>
              )}
              {open && phase !== "practice" && (
                <button
                  className="btn danger-ghost"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Kết thúc vòng luyện và khóa nhận bài?"))
                      void action("admin/control", { action: "finish" });
                  }}
                >
                  Kết thúc
                </button>
              )}
            </div>
            {waiting && (
              <form
                className="schedule-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = new FormData(e.currentTarget).get(
                    "time",
                  ) as string;
                  void action(
                    "admin/control",
                    {
                      action: "schedule",
                      scheduledAt: new Date(value + "+07:00").toISOString(),
                    },
                    "Đã hẹn giờ.",
                  );
                }}
              >
                <label>
                  Hẹn giờ bắt đầu (UTC+7)
                  <input name="time" type="datetime-local" required />
                </label>
                <button className="btn" disabled={busy || !data.ready}>
                  <Clock3 size={16} />
                  Hẹn giờ
                </button>
              </form>
            )}
          </div>
        </div>
        <RoundAccessControls data={data} busy={busy} action={action} />
      </section>
      <section className="panel round-config-panel">
        <div className="section-title">
          <h2>Cấu hình vòng luyện</h2>
          <span className="pill neutral">
            {waiting ? "Có thể chỉnh sửa" : "Đã áp dụng"}
          </span>
        </div>
        <form
          key={`${c.id}-${c.publicSeconds}-${c.privateSeconds}-${c.publicLimit}-${c.privateLimit}-${c.unlimited}-${c.autoApprove}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action("admin/control", {
              action: "configure",
              title: f.get("title"),
              publicSeconds: Number(f.get("public")) * 60,
              privateSeconds: Number(f.get("private")) * 60,
              publicLimit: Number(f.get("publicLimit")),
              privateLimit: Number(f.get("privateLimit")),
              unlimited: f.get("unlimited") === "on",
              autoApprove: f.get("autoApprove") === "on",
            });
          }}
        >
          <fieldset disabled={busy || !waiting}>
            <label>
              Tên vòng luyện
              <input
                name="title"
                defaultValue={c.title}
                minLength={3}
                maxLength={100}
                required
              />
            </label>
            <div className="field-grid">
              <label>
                Public (phút)
                <input
                  name="public"
                  type="number"
                  min="0.5"
                  max="720"
                  step="0.5"
                  defaultValue={c.publicSeconds / 60}
                  required
                />
              </label>
              <label>
                Private (phút)
                <input
                  name="private"
                  type="number"
                  min="0.5"
                  max="120"
                  step="0.5"
                  defaultValue={c.privateSeconds / 60}
                  required
                />
              </label>
              <label>
                Quota public
                <input
                  name="publicLimit"
                  type="number"
                  min="1"
                  max="1000"
                  defaultValue={c.publicLimit}
                  required
                />
                <small className="field-unit">lượt / tác vụ / đội</small>
              </label>
              <label>
                Quota private
                <input
                  name="privateLimit"
                  type="number"
                  min="1"
                  max="1000"
                  defaultValue={c.privateLimit}
                  required
                />
                <small className="field-unit">lượt / tác vụ / đội</small>
              </label>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                name="unlimited"
                defaultChecked={c.unlimited}
              />
              Mở vô thời hạn
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                name="autoApprove"
                defaultChecked={c.autoApprove !== false}
              />
              Tự động duyệt đăng ký
            </label>
            <button className="btn">Lưu cấu hình</button>
          </fieldset>
        </form>
        {open && (
          <QuotaGrant key={c.id} data={data} busy={busy} action={action} />
        )}
      </section>
      <section className="panel round-registrations-panel">
        <div className="section-title">
          <h2>
            <ShieldCheck size={19} />
            Đăng ký tham gia ({data.registrations.length})
          </h2>
          <label className="check-label compact-check">
            <input
              type="checkbox"
              checked={c.autoApprove !== false}
              disabled={busy}
              onChange={(e) =>
                action("admin/control", {
                  action: "approval-mode",
                  autoApprove: e.target.checked,
                })
              }
            />
            Tự duyệt đăng ký mới
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Thí sinh</th>
                <th>Đăng ký lúc</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.registrations.length ? (
                data.registrations.map((r) => (
                  <tr key={r.userId}>
                    <td>
                      <b>{r.name}</b>
                      <small>
                        {r.username.includes("@")
                          ? r.username
                          : `@${r.username}`}
                      </small>
                    </td>
                    <td>{when(r.registeredAt)}</td>
                    <td>
                      <span
                        className={`pill ${r.status === "approved" ? "green" : "neutral"}`}
                      >
                        {r.status === "approved"
                          ? "Đã duyệt"
                          : r.status === "pending"
                            ? "Chờ duyệt"
                            : "Từ chối"}
                      </span>
                    </td>
                    <td>
                      <div className="action-row">
                        {r.status !== "approved" && (
                          <button
                            className="btn small-btn"
                            disabled={busy}
                            onClick={() =>
                              action("admin/registration", {
                                userId: r.userId,
                                status: "approved",
                              })
                            }
                          >
                            Duyệt
                          </button>
                        )}
                        {r.status !== "rejected" && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              action("admin/registration", {
                                userId: r.userId,
                                status: "rejected",
                              })
                            }
                          >
                            Từ chối
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>Chưa có đăng ký.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel admin-announcement-panel">
        <h2>
          <Bell size={20} />
          Thông báo
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void action(
              "admin/control",
              { action: "announce", text: new FormData(form).get("text") },
              "Đã đăng thông báo.",
            );
            form.reset();
          }}
        >
          <label>
            Nội dung
            <textarea name="text" maxLength={1000} required />
          </label>
          <button className="btn primary" disabled={busy}>
            <Bell size={16} />
            Đăng thông báo
          </button>
        </form>
      </section>
      <section className="panel admin-export-panel">
        <h3>Kết quả vòng luyện</h3>
        <p>
          {data.submissions.length} bài nộp · {data.teams.length} đội
        </p>
        <button
          className="btn"
          onClick={async () => {
            const result = await api("admin/export", {}, c.roundId);
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(result, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "ket-qua-vong-luyen.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <ArrowDownToLine size={16} />
          Xuất kết quả
        </button>
      </section>
    </div>
  );
}
export function PublishRound({ data, busy, action }: ViewProps) {
  const packages = [...data.packages].sort(
    (a, b) =>
      Number(b.id.includes("-clean-")) - Number(a.id.includes("-clean-")),
  );
  return (
    <section className="panel publish-panel">
      <div className="section-title">
        <h2>
          <Plus size={19} />
          Phát hành vòng luyện
        </h2>
        <span className="pill neutral">Quản trị viên</span>
      </div>
      <p>
        Bộ đề mới được nạp vào danh sách quản trị. Xác nhận phát hành để vòng
        luyện xuất hiện cho thí sinh đăng ký.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (
            confirm(
              "Phát hành vòng luyện này cho tất cả thí sinh? Đề và dữ liệu vẫn khóa cho đến khi bắt đầu.",
            )
          )
            void action(
              "admin/round/create",
              { title: f.get("title"), packageId: f.get("packageId") },
              "Đã phát hành vòng luyện.",
            );
        }}
      >
        <div className="field-grid publish-fields">
          <label>
            Bộ đề
            <select name="packageId" required>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.id.includes("-clean-")
                    ? " · Bản chuẩn hóa"
                    : " · Bản trước"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tên vòng luyện
            <input
              name="title"
              placeholder="Vòng luyện 02"
              minLength={3}
              maxLength={100}
              required
            />
          </label>
          <button
            className="btn primary"
            disabled={busy || !data.packages.length}
          >
            Xác nhận phát hành
            <Plus size={16} />
          </button>
        </div>
      </form>
    </section>
  );
}

function QuotaGrant({ data, busy, action }: ViewProps) {
  const c = data.contest!;
  const [split, setSplit] = useState<"public" | "private">(
    phaseOf(c, data.serverNow) === "private" ? "private" : "public",
  );
  const [amount, setAmount] = useState(5);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    setRequestId(crypto.randomUUID());
  }, [c.publicLimit, c.privateLimit]);
  const current = split === "public" ? c.publicLimit : c.privateLimit;
  return (
    <form
      className="quota-grant"
      onSubmit={(e) => {
        e.preventDefault();
        void action(
          "admin/control",
          { action: "grant-quota", runId: c.id, split, amount, requestId },
          `Đã tăng ${amount} lượt ${split} cho mỗi tác vụ của tất cả đội.`,
        );
      }}
    >
      <div>
        <h3>Tăng quota cho tất cả đội</h3>
        <p>Cộng lượt cho mỗi tác vụ, giữ nguyên số lượt đã dùng.</p>
      </div>
      <fieldset disabled={busy} className="quota-fields">
        <label>
          Bộ kiểm thử
          <select
            value={split}
            onChange={(e) => {
              setSplit(e.target.value as "public" | "private");
              setRequestId(crypto.randomUUID());
            }}
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label>
          Số lượt cộng thêm
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={amount}
            required
            onChange={(e) => {
              setAmount(Number(e.target.value));
              setRequestId(crypto.randomUUID());
            }}
          />
        </label>
        <button className="btn primary" disabled={current + amount > 1000}>
          <Plus size={17} />
          Tăng quota
        </button>
      </fieldset>
      <small>
        Hạn mức {split}:{" "}
        <b>
          {current} → {current + amount}
        </b>{" "}
        lượt / tác vụ / đội.
      </small>
    </form>
  );
}
