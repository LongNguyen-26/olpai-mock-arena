"use client";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  Layers3,
  Users,
  Play,
  EyeOff,
} from "lucide-react";
import RoundVisibilityButton from "./round-visibility-button";
import { duration, type ArenaData } from "./arena-client";
import { roundTiming } from "@/lib/round-presentation";

const names = {
  waiting: "Chờ bắt đầu",
  scheduled: "Sắp diễn ra",
  public: "Đang mở · Public",
  private: "Đang mở · Private",
  practice: "Đang mở · Luyện tập tiếp",
  ended: "Đã kết thúc",
};
const startDateFormat = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default function RoundCard({
  round: r,
  now,
  onEnter,
  admin = false,
  busy = false,
  onStart,
  onVisibility,
}: {
  round: ArenaData["rounds"][number];
  now: number;
  onEnter: () => void;
  admin?: boolean;
  busy?: boolean;
  onStart?: () => void;
  onVisibility?: (hidden: boolean) => void;
}) {
  const timing = roundTiming(r, now);
  const live = ["public", "private", "practice"].includes(timing.phase);
  return (
    <article className={`panel round-card ${live ? "round-is-live" : ""}`}>
      <a
        className="round-card-link"
        aria-label={`Vào ${r.title}`}
        href={`/?round=${encodeURIComponent(r.id)}#overview`}
        onClick={(e) => {
          e.preventDefault();
          onEnter();
        }}
      />
      <div className="round-card-body">
        <div className="round-card-heading">
          <span className="round-emblem">
            <Layers3 size={25} />
          </span>
          <span className={`pill round-phase ${live ? "green" : "neutral"}`}>
            <i aria-hidden="true" />
            {names[timing.phase]}
          </span>
          {r.registration?.status === "approved" && (
            <span className="round-registration">
              <i aria-hidden="true" />
              Đã đăng ký
            </span>
          )}
          {r.hidden && (
            <span className="pill round-hidden-badge">
              <EyeOff size={13} />
              Đã ẩn
            </span>
          )}
          {r.registration?.status === "pending" && (
            <span className="round-registration pending">
              Chờ duyệt đăng ký
            </span>
          )}
        </div>
        <h2>{r.title}</h2>
        <div className="round-meta">
          <span>
            <Clock3 size={18} />
            {r.practice
              ? r.practice.endAt == null
                ? "Luyện tập không giới hạn"
                : "Luyện tập có thời hạn"
              : r.unlimited
                ? "Không giới hạn"
                : `${(r.publicSeconds + r.privateSeconds) / 3600} giờ`}
          </span>
          <span>
            <BookOpen size={18} />
            {r.taskCount} tác vụ
          </span>
          <span>
            <Users size={18} />
            <b>{r.registrationCount}</b> thí sinh đăng ký
          </span>
        </div>
      </div>
      <div className="round-card-side">
        <div className={`round-countdown ${live ? "is-live" : ""}`}>
          <span>
            {timing.phase === "waiting" ? "Sẵn sàng luyện tập" : timing.label}
          </span>
          <strong>
            {timing.phase === "waiting"
              ? "Chờ mở vòng"
              : timing.phase === "ended"
                ? "00:00:00"
                : timing.seconds === null
                  ? "Không giới hạn"
                  : duration(timing.seconds)}
          </strong>
          {r.startAt !== null && (
            <p className="round-start">
              Bắt đầu vào{" "}
              <time dateTime={new Date(r.startAt).toISOString()}>
                {startDateFormat.format(r.startAt)}
              </time>
            </p>
          )}
        </div>
        <div className="round-card-footer">
          <button className="btn primary" onClick={onEnter}>
            {timing.phase === "ended" ? "Xem vòng luyện" : "Vào vòng luyện"}
            <ArrowRight size={19} />
          </button>
        </div>
        {admin && (
          <div
            className="round-admin-actions"
            role="group"
            aria-label={`Quản trị ${r.title}`}
          >
            {["waiting", "scheduled"].includes(timing.phase) && (
              <button
                type="button"
                className="btn small-btn"
                disabled={busy}
                onClick={onStart}
              >
                <Play size={15} />
                Bắt đầu
              </button>
            )}
            <RoundVisibilityButton
              hidden={r.hidden}
              title={r.title}
              busy={busy}
              onChange={(value) => onVisibility?.(value)}
            />
          </div>
        )}
      </div>
    </article>
  );
}
