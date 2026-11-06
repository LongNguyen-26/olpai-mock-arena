"use client";
import { ScoreNote } from "./score-settings";
import { scoreLabel } from "@/lib/score-display";
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
import { coverFor } from "@/lib/task-cover";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  api,
  bytes,
  duration,
  endpoint,
  fmt,
  when,
  tableDate,
  type ViewProps,
} from "./arena-client";
import { contestEnd, submissionAccess } from "@/lib/domain";
import type { Phase, TaskId, TaskStatement } from "@/lib/types";
type Props = ViewProps & {
  phase: Phase;
  now: number;
  go: (section: string) => void;
  statementTask: string;
  openTask: (task: TaskId) => void;
  refresh: () => Promise<void>;
  report: (error: string) => void;
};
const names = {
  waiting: "Chưa mở",
  scheduled: "Đã hẹn giờ",
  public: "PUBLIC",
  private: "PRIVATE",
  practice: "Luyện tập tiếp",
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
export function OverviewView({ data, phase, now, go, openTask }: Props) {
  const c = data.contest;
  if (!c) return null;
  const locked = !data.canReadStatement,
    open = ["public", "private", "practice"].includes(phase),
    end = contestEnd(c),
    target = phase === "scheduled" ? c.startAt : open ? end : null,
    remaining = target
      ? Math.max(0, Math.ceil((target - now) / 1000))
      : c.publicSeconds + c.privateSeconds;
  const destination = data.user?.admin ? "admin" : "statement";
  const entryLabel = data.user?.admin ? "Quản trị vòng luyện" : "Xem đề thi";
  const mySubs = data.submissions.filter(
      (s) => s.teamId === data.user?.teamId && s.status !== "invalid",
    ),
    myRank = data.leaderboard[
      phase === "private" || phase === "ended" ? "private" : "public"
    ]?.find((r) => r.teamId === data.user?.teamId);
  return (
    <>
      <a className="hero" href={`/?round=${encodeURIComponent(c.roundId ?? c.id)}#${destination}`}
        aria-label={`${entryLabel} · ${c.title}`}
        onClick={e => {
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          go(destination);
        }}>
        <div className="hero-copy">
          <span className="pill hero-pill">
            <span className="status-dot" />
            {names[phase]}
          </span>
          <h2>{c.title}</h2>
          <div className="hero-meta">
            <span>
              <Clock3 size={20} />
              {phase === "practice"
                ? end == null
                  ? "Luyện tập không giới hạn"
                  : "Luyện tập có thời hạn"
                : c.unlimited
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
          <span className="btn orange-btn">{entryLabel} <ArrowRight size={18} /></span>
        </div>
        <div className="hero-timer">
          <span className="eyebrow">
            {phase === "scheduled"
              ? "BẮT ĐẦU SAU"
              : open
                ? "THỜI GIAN CÒN LẠI"
                : "THỜI LƯỢNG"}
          </span>
          <strong className={open && target === null ? "infinite-clock" : ""}>
            {phase === "ended"
              ? "00:00:00"
              : open && target === null
                ? "Không giới hạn"
                : duration(remaining)}
          </strong>
          <p>
            {open
              ? `Nhận bài: ${(["public", "private"] as const).filter((s) => submissionAccess(c, now, s).accepting).join(" + ") || "đang khóa"}`
              : phase === "ended"
                ? "Đã kết thúc"
                : "Chờ quản trị viên bắt đầu"}
          </p>
        </div>
      </a>
      <div className="stat-grid">
        <Stat
          icon={<Users size={21} />}
          label={!data.user || data.user?.admin ? "Đội tham gia" : "Đội của bạn"}
          value={
            !data.user || data.user?.admin
              ? String(data.teamCount)
              : (data.team?.name ?? "Chưa có đội")
          }
          caption={
            !data.user || data.user?.admin
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
            data.user?.admin
              ? "Bài nộp hợp lệ"
              : phase === "private" || phase === "ended"
                ? "Điểm private"
                : "Điểm public"
          }
          value={
            data.user?.admin
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
        <ol className="round-route">
          {[
            { phases: ["waiting", "scheduled"], title: "Chờ bắt đầu", note: "Đăng ký tham gia" },
            { phases: ["public"], title: "Public", note: `${c.publicLimit} lượt / tác vụ` },
            { phases: ["private"], title: "Private", note: `${c.privateLimit} lượt / tác vụ` },
            { phases: ["ended"], title: "Kết thúc", note: "Điểm chung cuộc" },
            ...(c.practice ? [{ phases: ["practice"], title: "Luyện tập tiếp", note: c.practice.endAt ? "Có thời hạn" : "Không giới hạn" }] : []),
          ].map((step, index) => <li key={step.title} aria-current={step.phases.includes(phase) ? "step" : undefined}>
            <span className="route-mark" aria-hidden="true">{index + 1}</span>
            <span><b>{step.title}</b><small>{step.note}</small></span>
          </li>)}
        </ol>
      </section>
      <div className="section-title outside">
        <h2>Đề thi</h2>
      </div>
      <div className="task-grid">
        {data.taskIds.map(id => {
          const title = locked ? "Chưa mở" : data.tasks.find(t => t.id === id)?.title.replace(/^Tác vụ \d+\s*/, "") ?? `Tác vụ 0${id}`;
          const scores = mySubs.filter(s => s.task === id && s.split === "public" && s.score != null);
          const best = scores.length ? Math.max(...scores.map(s => s.score!)) : null;
          return <article className="overview-task" key={id}>
            <div className="overview-task-head" style={{backgroundImage: `linear-gradient(90deg, #fff 18%, #fffffff2 45%, #ffffff0a 92%), url(/round-covers/${coverFor(title)}.svg)`}}>
              <small>Tác vụ 0{id}</small><h3>{title}</h3>
            </div>
            <div className="overview-task-foot">
              <span>Public tốt nhất <b>{fmt(best)}</b></span>
              <a className="task-enter" aria-label={`Xem đề tác vụ ${id}`} href={`/?round=${encodeURIComponent(c.roundId ?? c.id)}&task=${id}#statement`}
                onClick={e => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); openTask(id); } }}>
                Xem đề {locked ? <LockKeyhole size={15}/> : <ArrowRight size={15}/>}
              </a>
            </div>
          </article>;
        })}
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
export function StatementView({ data, go, report, statementTask, openTask }: Props) {
  const task = data.taskIds.find(id => id === statementTask) ?? data.taskIds[0];
  const [statements, setStatements] = useState<TaskStatement[]>([]);
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
              onClick={() => openTask(id)}
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
          <Markdown remarkPlugins={[remarkGfm]} urlTransform={(url, key) =>
            key === "src" && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(url) ? url : defaultUrlTransform(url)
          }>
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
              className="btn primary asset-download"
              aria-label={`Tải trực tiếp ${a.name}`}
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
        <div className="score-tools"><span className="participation-count">
          <Users size={18} />
          {data.participantCount} thí sinh · {data.teamCount} đội
        </span>
          {(board === "public" || data.leaderboard.private) && <ScoreNote data={data} split={board}/>}
        </div>
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
                <th title="Lần nộp muộn nhất trong các bài đạt điểm tốt nhất của từng tác vụ (UTC+7)">Ngày</th>
              </tr>
            </thead>
            <tbody>
              {data.leaderboard[board]?.length ? (
                data.leaderboard[board]!.map((r) => (
                  <tr
                    key={r.teamId}
                    className={r.teamId === data.user?.teamId ? "my-team" : ""}
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
                        {fmt(r.scores[id])}{data.scoreDisplay.extra && <small className="score-extra">{scoreLabel[data.scoreDisplay.extra]} · {fmt(r.extras[id])}</small>}
                      </td>
                    ))}
                    <td className="total-score mono">{fmt(r.total)}{data.scoreDisplay.extra && <small className="score-extra">{scoreLabel[data.scoreDisplay.extra]} · {fmt(r.extraTotal)}</small>}</td>
                    <td>{r.submitted}</td>
                    <td className="table-date"><time dateTime={new Date(r.lastAt).toISOString()}>{tableDate(r.lastAt)}</time></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5 + data.taskIds.length}>
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
