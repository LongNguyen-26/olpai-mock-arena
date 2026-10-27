"use client";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Clock3,
  Database,
  Flag,
  LockKeyhole,
  Medal,
  Send,
  Trophy,
  Users,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  api,
  bytes,
  duration,
  endpoint,
  fmt,
  when,
  type ViewProps,
} from "./arena-client";
import { contestEnd } from "@/lib/domain";
import type { Phase, TaskId, TaskStatement } from "@/lib/types";
type Props = ViewProps & {
  phase: Phase;
  now: number;
  go: (section: string) => void;
  refresh: () => Promise<void>;
  report: (error: string) => void;
};
const names = {
  waiting: "Chưa mở",
  scheduled: "Đã hẹn giờ",
  public: "PUBLIC",
  private: "PRIVATE",
  ended: "Đã kết thúc",
};
function Locked({
  title,
  text,
  children,
}: {
  title: string;
  text?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="locked">
      <span className="lock-circle">
        <LockKeyhole size={27} />
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
export function OverviewView({ data, phase, now, go }: Props) {
  const c = data.contest;
  if (!c) return null;
  const locked = !data.canReadStatement,
    open = ["public", "private"].includes(phase),
    end = contestEnd(c),
    target =
      phase === "scheduled"
        ? c.startAt
        : phase === "public" || phase === "private"
          ? end
          : null,
    remaining = target
      ? Math.max(0, Math.ceil((target - now) / 1000))
      : c.publicSeconds + c.privateSeconds;
  const mySubs = data.submissions.filter(
      (s) => s.teamId === data.user.teamId && s.status !== "invalid",
    ),
    myRank = data.leaderboard[
      phase === "private" || phase === "ended" ? "private" : "public"
    ]?.find((r) => r.teamId === data.user.teamId);
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="pill hero-pill">
            <span className="status-dot" />
            {names[phase]}
          </span>
          <h2>{c.title}</h2>
          <div className="hero-meta">
            <span>
              <Clock3 size={20} />
              {c.unlimited
                ? "Không giới hạn"
                : `${(c.publicSeconds + c.privateSeconds) / 3600} giờ thi`}
            </span>
            <span>
              <BookOpen size={20} />
              {data.taskIds.length} tác vụ
            </span>
            <span>
              <Users size={20} />
              Tối đa 3 thành viên
            </span>
          </div>
          <button
            className="btn orange-btn"
            onClick={() => go(data.user.admin ? "admin" : "statement")}
          >
            {data.user.admin ? "Quản trị vòng luyện" : "Vào làm bài"}
            <ArrowRight size={18} />
          </button>
        </div>
        <div className="hero-timer">
          <span className="eyebrow">
            {phase === "scheduled"
              ? "BẮT ĐẦU SAU"
              : open
                ? "THỜI GIAN CÒN LẠI"
                : "THỜI LƯỢNG"}
          </span>
          <strong
            className={c.unlimited && target === null ? "infinite-clock" : ""}
          >
            {phase === "ended"
              ? "00:00:00"
              : c.unlimited && target === null
                ? "Không giới hạn"
                : duration(remaining)}
          </strong>
          <p>
            {phase === "public"
              ? "Nhận bài public"
              : phase === "private"
                ? "Nhận bài private"
                : phase === "ended"
                  ? "Đã kết thúc"
                  : "Chờ quản trị viên bắt đầu"}
          </p>
        </div>
      </section>
      <div className="stat-grid">
        <Stat
          icon={<Users size={21} />}
          label={data.user.admin ? "Đội tham gia" : "Đội của bạn"}
          value={
            data.user.admin
              ? String(data.teamCount)
              : (data.team?.name ?? "Chưa có đội")
          }
          caption={
            data.user.admin
              ? `${data.participantCount} thí sinh`
              : data.team
                ? `${data.team.members.length}/3 thành viên`
                : undefined
          }
        />
        <Stat
          icon={<Send size={21} />}
          label="Thí sinh tham gia"
          value={String(data.participantCount)}
          caption={`${data.teamCount} đội`}
        />
        <Stat
          icon={<Trophy size={21} />}
          label={
            data.user.admin
              ? "Bài nộp hợp lệ"
              : phase === "private" || phase === "ended"
                ? "Điểm private"
                : "Điểm public"
          }
          value={
            data.user.admin
              ? String(
                  data.submissions.filter(
                    (s) => s.status !== "invalid" && !s.adminTest,
                  ).length,
                )
              : fmt(myRank?.total)
          }
        />
      </div>
      <section className="panel schedule-panel">
        <div className="section-title">
          <h2>
            <Clock3 size={19} />
            Lộ trình vòng luyện
          </h2>
        </div>
        <div className="timeline">
          {[
            {
              n: "01",
              title: "Chờ bắt đầu",
              caption: "Đăng ký tham gia",
              active: ["waiting", "scheduled"].includes(phase),
            },
            {
              n: "02",
              title: "Mở public",
              caption: `${c.publicLimit} lượt / tác vụ`,
              active: phase === "public",
            },
            {
              n: "03",
              title: "Mở private",
              caption: `${c.privateLimit} lượt / tác vụ`,
              active: phase === "private",
            },
            {
              n: "04",
              title: "Kết thúc",
              caption: "Điểm chung cuộc",
              active: phase === "ended",
            },
          ].map((s) => (
            <div
              className={`timeline-step ${s.active ? "current" : ""}`}
              key={s.n}
            >
              <span className="step-number">{s.n}</span>
              <div>
                <b>{s.title}</b>
                <small>{s.caption}</small>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="section-title outside">
        <h2>Đề thi</h2>
      </div>
      <div className="task-grid">
        {data.taskIds.map((id) => (
          <article className="task-card simple-task" key={id}>
            <span className="pill neutral">TÁC VỤ 0{id}</span>
            <h3>
              {locked
                ? `Tác vụ 0${id} · Chưa mở`
                : (data.tasks
                    .find((t) => t.id === id)
                    ?.title.replace(/^Tác vụ \d+\s*/, "") ?? `Tác vụ 0${id}`)}
            </h3>
            <div className="task-footer">
              <span>
                Public tốt nhất{" "}
                <b>
                  {fmt(
                    mySubs
                      .filter((s) => s.task === id && s.split === "public")
                      .reduce<
                        number | null
                      >((best, s) => (best === null ? s.score : Math.max(best, s.score ?? 0)), null),
                  )}
                </b>
              </span>
              <button onClick={() => go("statement")}>
                {locked ? <LockKeyhole size={18} /> : <ArrowRight size={18} />}
                Xem đề
              </button>
            </div>
          </article>
        ))}
      </div>
      <section className="panel announcement-panel">
        <div className="section-title">
          <h2>
            <Bell size={19} />
            Thông báo
          </h2>
        </div>
        {data.announcements.length ? (
          data.announcements.map((a) => (
            <div className="announcement" key={a.id}>
              <span className="announcement-icon">
                <Flag size={17} />
              </span>
              <div>
                <small>{when(a.createdAt)}</small>
                <p>{a.text}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="announcement">
            <span className="announcement-icon">
              <Bell size={18} />
            </span>
            <div>
              <b>Chưa có thông báo</b>
              <p>
                Các thông báo của quản trị viên sẽ hiển thị tại đây. Đề và dữ
                liệu sẽ mở khi admin bắt đầu.
              </p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
export function StatementView({ data, go, report }: Props) {
  const [task, setTask] = useState<TaskId>("1"),
    [statements, setStatements] = useState<TaskStatement[]>([]);
  const c = data.contest;
  useEffect(() => {
    setStatements([]);
    if (!c || !data.canReadStatement) return;
    let cancelled = false;
    api("statement", undefined, c.roundId)
      .then((result) => {
        if (!cancelled) setStatements(result.tasks);
      })
      .catch((e) => {
        if (!cancelled) report(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [c?.id, data.canReadStatement, report]);
  if (!data.canReadStatement)
    return (
      <Locked
        title="Đề thi chưa mở"
        text="Đề và dữ liệu sẽ mở khi admin bắt đầu."
      />
    );
  return (
    <section className="panel statement-panel">
      <div className="statement-head">
        <div className="segmented">
          {data.taskIds.map((id) => (
            <button
              key={id}
              className={task === id ? "active" : ""}
              onClick={() => setTask(id)}
            >
              Tác vụ 0{id}
            </button>
          ))}
        </div>
        <button className="btn small-btn" onClick={() => go("data")}>
          <ArrowDownToLine size={16} />
          Dữ liệu
        </button>
      </div>
      <div className="statement-title">
        <p>{data.contest?.title}</p>
        <h2>
          Tác vụ {task} -{" "}
          {statements.find((t) => t.id === task)?.title ??
            data.tasks.find((t) => t.id === task)?.title ??
            "Đang tải đề thi…"}
        </h2>
      </div>
      <div className="prose">
        {statements.length ? (
          <Markdown remarkPlugins={[remarkGfm]}>
            {(statements.find((t) => t.id === task)?.content ?? "").replace(
              /^#[ \t]+Tác vụ[ \t]+\d+[^\n]*(?:\n|$)/gim,
              "",
            )}
          </Markdown>
        ) : (
          <p>Đang tải đề thi…</p>
        )}
      </div>
    </section>
  );
}
export function DataView({ data }: Props) {
  if (!data.canReadStatement)
    return (
      <Locked
        title="Dữ liệu chưa mở"
        text="Đề và dữ liệu sẽ mở khi admin bắt đầu."
      />
    );
  const id = data.contest?.roundId ?? "";
  return (
    <div className="asset-grid">
      {data.assets.map((a) => (
        <article className="panel asset-card" key={a.key}>
          <div className="asset-icon">
            <Database size={25} />
          </div>
          <span
            className={`pill ${a.phase === "private" ? "lavender" : "neutral"}`}
          >
            {a.phase}
          </span>
          <h3>{a.name}</h3>
          <div className="asset-size">{bytes(a.bytes)}</div>
          <div className="asset-actions">
            <a
              className="btn primary"
              href={
                endpoint("download", id) + `&asset=${encodeURIComponent(a.key)}`
              }
            >
              <ArrowDownToLine size={16} />
              Tải trực tiếp
            </a>
            {a.driveUrl && (
              <a
                className="btn"
                target="_blank"
                rel="noreferrer"
                href={
                  endpoint("download", id) +
                  `&source=drive&asset=${encodeURIComponent(a.key)}`
                }
              >
                Mở trên Drive
                <ArrowUpRight size={15} />
              </a>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
export { default as SubmitView } from "./submission-view";
export function BoardView({ data }: Props) {
  const [board, setBoard] = useState<"public" | "private">("public");
  return (
    <section className="panel">
      <div className="section-title">
        <div className="segmented board-tabs">
          <button
            className={board === "public" ? "active" : ""}
            onClick={() => setBoard("public")}
          >
            Public
          </button>
          <button
            className={board === "private" ? "active" : ""}
            onClick={() => setBoard("private")}
          >
            Private
          </button>
        </div>
        <span className="participation-count">
          <Users size={18} />
          {data.participantCount} thí sinh · {data.teamCount} đội
        </span>
      </div>
      {board === "private" && !data.leaderboard.private ? (
        <Locked title="Điểm private chưa được mở" />
      ) : (
        <div className="table-scroll">
          <table className="leaderboard">
            <thead>
              <tr>
                <th>Hạng</th>
                <th>Đội</th>
                {data.taskIds.map((id) => (
                  <th key={id}>Tác vụ 0{id}</th>
                ))}
                <th>Tổng điểm</th>
                <th>Số bài nộp</th>
              </tr>
            </thead>
            <tbody>
              {data.leaderboard[board]?.length ? (
                data.leaderboard[board]!.map((r) => (
                  <tr
                    key={r.teamId}
                    className={r.teamId === data.user.teamId ? "my-team" : ""}
                  >
                    <td>
                      <span className={`rank rank-${r.rank}`}>
                        {r.rank <= 3 && <Medal size={19} />} {r.rank}
                      </span>
                    </td>
                    <td>
                      <b>{r.name}</b>
                    </td>
                    {data.taskIds.map((id) => (
                      <td key={id} className="mono">
                        {fmt(r.scores[id])}
                      </td>
                    ))}
                    <td className="total-score mono">{fmt(r.total)}</td>
                    <td>{r.submitted}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4 + data.taskIds.length}>
                    <div className="empty">
                      <Trophy size={30} />
                      <b>Chưa có điểm</b>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function Stat({
  icon,
  label,
  value,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <article className="stat-card">
      <span className="stat-icon">{icon}</span>
      <div>
        <span className="stat-label">{label}</span>
        <strong>{value}</strong>
        {caption && <small>{caption}</small>}
      </div>
    </article>
  );
}
