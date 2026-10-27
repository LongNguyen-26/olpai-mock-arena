"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CheckCircle2,
  Clock3,
  Database,
  Flag,
  LockKeyhole,
  Medal,
  RefreshCw,
  Send,
  Trophy,
  UploadCloud,
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
import { contestEnd, privateStart } from "@/lib/domain";
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
  public: "Đang nhận public",
  private: "Đang nhận private",
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
    p = privateStart(c),
    end = contestEnd(c),
    target =
      phase === "scheduled"
        ? c.startAt
        : phase === "public"
          ? p
          : phase === "private"
            ? end
            : null,
    remaining = target
      ? Math.max(0, Math.ceil((target - now) / 1000))
      : c.publicSeconds + c.privateSeconds;
  const mySubs = data.submissions.filter((s) => s.teamId === data.user.teamId),
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
              <BookOpen size={20} />2 tác vụ
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
            className={
              c.unlimited && phase !== "scheduled" ? "infinite-clock" : ""
            }
          >
            {phase === "ended"
              ? "00:00:00"
              : c.unlimited && phase !== "scheduled"
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
          label="Đội của bạn"
          value={data.team?.name ?? "Chưa có đội"}
          caption={
            data.team ? `${data.team.members.length}/3 thành viên` : undefined
          }
        />
        <Stat
          icon={<Send size={21} />}
          label="Số bài nộp"
          value={String(mySubs.length)}
        />
        <Stat
          icon={<Trophy size={21} />}
          label={
            phase === "private" || phase === "ended"
              ? "Điểm private"
              : "Điểm public"
          }
          value={fmt(myRank?.total)}
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
        {(["1", "2"] as const).map((id) => (
          <article className="task-card simple-task" key={id}>
            <span className="pill neutral">TÁC VỤ 0{id}</span>
            <h3>
              {locked
                ? `Tác vụ 0${id} · Chưa mở`
                : (data.tasks.find((t) => t.id === id)?.title ??
                  `Tác vụ 0${id}`)}
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
                      >((best, s) => (best === null ? s.score : Math.max(best, s.score)), null),
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
          {(["1", "2"] as const).map((id) => (
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
      <div className="prose">
        {statements.length ? (
          <Markdown remarkPlugins={[remarkGfm]}>
            {statements.find((t) => t.id === task)?.content ?? ""}
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
export function SubmitView({ data, phase, busy, go, refresh, report }: Props) {
  const [task, setTask] = useState<TaskId>("1"),
    [sending, setSending] = useState(false);
  const nonce = useRef(crypto.randomUUID()),
    input = useRef<HTMLInputElement>(null);
  const c = data.contest;
  if (!c) return null;
  const open = ["public", "private"].includes(phase),
    count = data.submissions.filter(
      (s) =>
        s.teamId === data.user.teamId && s.task === task && s.split === phase,
    ).length,
    quota = phase === "private" ? c.privateLimit : c.publicLimit;
  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    f.set("task", task);
    f.set("split", phase);
    f.set("nonce", nonce.current);
    setSending(true);
    report("");
    try {
      const res = await fetch(endpoint("submit", c!.roundId), {
        method: "POST",
        body: f,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      nonce.current = crypto.randomUUID();
      if (input.current) input.current.value = "";
      await refresh();
    } catch (e) {
      report(
        e instanceof Error
          ? e.message
          : "Không thể nộp bài. Kiểm tra lịch sử trước khi thử lại.",
      );
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <div className="submission-grid">
        <section className="panel">
          <div className="section-title">
            <h2>
              <UploadCloud size={20} />
              Nộp bài
            </h2>
            <span className="pill neutral">{names[phase]}</span>
          </div>
          {data.user.admin ? (
            <Locked
              title="Tài khoản quản trị"
              text="Đăng nhập bằng tài khoản thí sinh để nộp bài."
            />
          ) : !open ? (
            <Locked
              title="Chưa mở hoặc đã khóa nhận bài"
              text="Xem thời gian và trạng thái trên trang tổng quan."
            />
          ) : !data.team ? (
            <Locked title="Bạn chưa có đội">
              <button className="btn primary" onClick={() => go("team")}>
                Tạo hoặc tham gia đội
              </button>
            </Locked>
          ) : (
            <form onSubmit={send}>
              <label>
                Tác vụ
                <select
                  value={task}
                  disabled={sending}
                  onChange={(e) => {
                    setTask(e.target.value as TaskId);
                    nonce.current = crypto.randomUUID();
                  }}
                >
                  {(["1", "2"] as const).map((id) => (
                    <option key={id} value={id}>
                      0{id} ·{" "}
                      {data.tasks.find((t) => t.id === id)?.title ??
                        `Tác vụ ${id}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="schema-line">
                <code>
                  {task === "1" ? "ImageId,EncodedPixels" : "id,prediction"}
                </code>
                <span>
                  {count}/{quota} lượt · {phase}
                </span>
              </div>
              <label className="dropzone">
                <UploadCloud size={32} />
                <b>Chọn tệp CSV</b>
                <span>UTF-8 · Tối đa 3 MB</span>
                <input
                  ref={input}
                  type="file"
                  name="file"
                  required
                  disabled={sending}
                  accept=".csv,text/csv"
                  onChange={() => {
                    nonce.current = crypto.randomUUID();
                  }}
                />
              </label>
              <label>
                Ghi chú <span className="muted">(không bắt buộc)</span>
                <input name="note" maxLength={300} />
              </label>
              <button
                className="btn primary wide"
                disabled={busy || sending || count >= quota}
              >
                {sending
                  ? "Đang chấm bài…"
                  : count >= quota
                    ? "Đã hết lượt nộp"
                    : "Nộp bài"}
                <Send size={17} />
              </button>
            </form>
          )}
        </section>
        <aside className="panel submit-help">
          <h3>Lưu ý nộp bài</h3>
          <p>CSV phải đúng cột, đầy đủ ID và đúng bộ kiểm thử đang mở.</p>
          <p>
            Bài lỗi định dạng không trừ quota. Bài hợp lệ được trả điểm ngay.
          </p>
          <p>
            Điểm public và private đều lấy kết quả cao nhất của từng tác vụ.
          </p>
          <p>Tổng điểm là tổng hai tác vụ, tối đa 200 điểm.</p>
        </aside>
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>Lịch sử nộp bài</h2>
          <button className="text-button" onClick={refresh}>
            Làm mới
            <RefreshCw size={15} />
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Bản nộp / thời gian</th>
                <th>Tác vụ</th>
                <th>Bộ kiểm thử</th>
                <th>Điểm</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {data.submissions.length ? (
                data.submissions.slice(0, 100).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <a
                        className="filename"
                        href={
                          endpoint("submission/download", c.roundId) +
                          `&id=${s.id}`
                        }
                      >
                        {s.filename}
                      </a>
                      <small>
                        {when(s.createdAt)}
                        {s.note ? ` · ${s.note}` : ""}
                      </small>
                    </td>
                    <td>0{s.task}</td>
                    <td>
                      <span
                        className={`pill ${s.split === "private" ? "lavender" : "neutral"}`}
                      >
                        {s.split}
                      </span>
                    </td>
                    <td className="mono">{fmt(s.score)}</td>
                    <td>
                      <span className="valid">
                        <CheckCircle2 size={15} />
                        Hợp lệ
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">
                      <UploadCloud size={30} />
                      <b>Chưa có bài nộp</b>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
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
                <th>Tác vụ 01</th>
                <th>Tác vụ 02</th>
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
                    <td className="mono">{fmt(r.task1)}</td>
                    <td className="mono">{fmt(r.task2)}</td>
                    <td className="total-score mono">{fmt(r.total)}</td>
                    <td>{r.submitted}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
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
