"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  Database,
  Flag,
  FlaskConical,
  Image as ImageIcon,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Medal,
  MessageSquareText,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { snapshot } from "@/lib/arena";
import { phaseOf } from "@/lib/domain";
import type { TaskId } from "@/lib/types";
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
type Section =
  | "overview"
  | "statement"
  | "data"
  | "submit"
  | "leaderboard"
  | "team"
  | "settings"
  | "admin";
const nav = [
  { id: "overview", label: "Tổng quan", icon: LayoutDashboard },
  { id: "statement", label: "Đề thi", icon: BookOpen },
  { id: "data", label: "Dữ liệu & tài nguyên", icon: Database },
  { id: "submit", label: "Nộp bài", icon: UploadCloud },
  { id: "leaderboard", label: "Bảng xếp hạng", icon: Trophy },
  { id: "team", label: "Đội của tôi", icon: Users },
] as const;
const phaseNames = {
  waiting: "Chưa bắt đầu",
  scheduled: "Đã hẹn giờ",
  public: "Public đang mở",
  private: "Private đang mở",
  ended: "Đã kết thúc",
};
const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
const when = (n: number) =>
  new Date(n).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
const bytes = (n: number) =>
  n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1000).toFixed(1)} KB`;
const duration = (n: number) =>
  `${Math.floor(n / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((n % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
async function api(route: string, value?: unknown) {
  const response = await fetch(
    `/api/${route}`,
    value === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "Không thể thực hiện yêu cầu.");
  return result;
}
export default function Arena() {
  const [data, setData] = useState<Snapshot | null>(null),
    [section, setSection] = useState<Section>("overview"),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [clock, setClock] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [statement, setStatement] = useState(""),
    [task, setTask] = useState<TaskId>("1"),
    [board, setBoard] = useState<"public" | "private">("public");
  const alive = useRef(true),
    loading = useRef(false),
    fileInput = useRef<HTMLInputElement>(null),
    submissionNonce = useRef(crypto.randomUUID());
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const start = Date.now();
      const d = await api("arena");
      if (alive.current) {
        setData(d);
        setOffset(d.serverNow - (start + Date.now()) / 2);
        setError("");
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Không thể tải dữ liệu.");
    } finally {
      loading.current = false;
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    const id = setInterval(load, 30000),
      tick = setInterval(() => setClock(Date.now()), 1000);
    const hash = () => {
      const v = window.location.hash.slice(1);
      if ([...nav.map((n) => n.id), "admin", "settings"].includes(v))
        setSection(v as Section);
    };
    hash();
    window.addEventListener("hashchange", hash);
    window.addEventListener("focus", load);
    return () => {
      alive.current = false;
      clearInterval(id);
      clearInterval(tick);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("focus", load);
    };
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const phase = data ? phaseOf(data.contest, clock + offset) : "waiting";
  useEffect(() => {
    if (data) void load();
  }, [phase, load]); // Synchronize resources at a phase boundary.
  useEffect(() => {
    if (
      section !== "statement" ||
      !data ||
      (!data.user.admin && ["waiting", "scheduled"].includes(phase))
    )
      return;
    api("statement")
      .then((d) => setStatement(d.statement))
      .catch((e) => setError(e.message));
  }, [section, phase, data?.packageVersion, data?.user.admin]);
  function go(s: Section) {
    setSection(s);
    window.location.hash = s;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function action(
    route: string,
    value: unknown,
    message = "Đã cập nhật.",
  ) {
    setBusy(true);
    setError("");
    try {
      await api(route, value);
      setToast(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    const form = new FormData(e.currentTarget);
    form.set("task", task);
    form.set("split", phase);
    form.set("nonce", submissionNonce.current);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/submit", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      submissionNonce.current = crypto.randomUUID();
      if (fileInput.current) fileInput.current.value = "";
      setToast("Đã nhận bản nộp hợp lệ. Xem kết quả trong lịch sử.");
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Kết nối gián đoạn. Kiểm tra lịch sử rồi thử lại cùng tệp.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <div className="loading-screen">
        <span className="brand-symbol">
          A<span>·</span>
        </span>
        <h2>Đang kết nối đấu trường…</h2>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="btn" onClick={load}>
              <RefreshCw size={16} />
              Thử lại
            </button>
            <a href="/login">Đăng nhập lại</a>
          </>
        ) : (
          <div className="loader" />
        )}
      </div>
    );
  const c = data.contest,
    isAdmin = data.user.admin,
    locked = !isAdmin && ["waiting", "scheduled"].includes(phase),
    open = phase === "public" || phase === "private",
    now = clock + offset;
  const publicEnd =
      c.startAt === null ? null : c.startAt + c.publicSeconds * 1000,
    end =
      c.startAt === null
        ? null
        : c.startAt + (c.publicSeconds + c.privateSeconds) * 1000;
  const target =
      phase === "scheduled"
        ? c.startAt
        : phase === "public"
          ? publicEnd
          : phase === "private"
            ? end
            : null,
    remaining = target
      ? Math.max(0, Math.ceil((target - now) / 1000))
      : c.publicSeconds + c.privateSeconds;
  const mySubs = data.submissions.filter((s) => s.teamId === data.user.teamId),
    count = mySubs.filter((s) => s.task === task && s.split === phase).length,
    quota = phase === "private" ? c.privateLimit : c.publicLimit;
  const title =
    section === "admin"
      ? "Điều hành buổi thi"
      : section === "settings"
        ? "Tài khoản của bạn"
        : nav.find((n) => n.id === section)?.label;
  const taskCards = (["1", "2"] as const).map((id, i) => {
    const score = Math.max(
      -1,
      ...mySubs
        .filter((s) => s.task === id && s.split === "public")
        .map((s) => s.score ?? -1),
    );
    return (
      <article className="task-card" key={id}>
        <div className="task-card-top">
          <div className={`task-icon task-${id}`}>
            {i === 0 ? (
              <ImageIcon size={23} />
            ) : (
              <MessageSquareText size={23} />
            )}
          </div>
          <span className="pill neutral">TÁC VỤ 0{id}</span>
          <ArrowUpRight size={19} />
        </div>
        <p className="eyebrow muted">
          {locked
            ? "NỘI DUNG CHƯA CÔNG BỐ"
            : i === 0
              ? "COMPUTER VISION"
              : "NATURAL LANGUAGE PROCESSING"}
        </p>
        <h3>
          {locked
            ? `Tác vụ 0${id} · Đang niêm phong`
            : i === 0
              ? "Tách từng nhân tế bào"
              : "Đọc hiểu & biết từ chối"}
        </h3>
        <p>
          {locked
            ? "Nội dung, dữ liệu và thước đo của tác vụ được công bố khi buổi thi bắt đầu."
            : i === 0
              ? "Phân đoạn từng cá thể trong ảnh kính hiển vi. Giải bài toán vật thể dính và lỗi gộp, tách."
              : "Trích xuất đáp án từ ngữ cảnh tiếng Anh, hoặc trả lời rỗng khi không đủ thông tin."}
        </p>
        <div className="task-tags">
          <span>
            {locked ? "Chờ mở đề" : i === 0 ? "BBBC038v1" : "SQuAD 2.0"}
          </span>
          <span>
            {locked ? "Giữ kín nội dung" : i === 0 ? "Instance AP" : "Token F1"}
          </span>
          <span>0–100 điểm</span>
        </div>
        <div className="task-footer">
          <span>
            Public tốt nhất <b>{score < 0 ? "—" : fmt(score)}</b>
          </span>
          <button onClick={() => go("statement")}>
            {locked ? <LockKeyhole size={15} /> : <ArrowRight size={17} />}{" "}
            {locked ? "Chờ mở đề" : "Xem đề"}
          </button>
        </div>
      </article>
    );
  });
  const history = (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Bản nộp / thời gian</th>
            <th>Tác vụ</th>
            <th>Giai đoạn</th>
            <th>Điểm</th>
            <th>Trạng thái</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.submissions.length ? (
            data.submissions.slice(0, 100).map((s) => (
              <tr key={s.id}>
                <td>
                  <a
                    href={`/api/submission/download?id=${s.id}`}
                    className="filename"
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
                <td className="mono">
                  {s.score === null ? (
                    <span title="Điểm công bố sau khi hết giờ">
                      <LockKeyhole size={14} /> Ẩn điểm
                    </span>
                  ) : (
                    fmt(s.score)
                  )}
                </td>
                <td>
                  <span className="valid">
                    <CheckCircle2 size={14} /> Hợp lệ
                  </span>
                </td>
                <td>
                  {s.split === "private" &&
                    s.teamId === data.user.teamId &&
                    (data.selections[`${s.teamId}:${s.task}`] === s.id ? (
                      <span className="pill green">
                        <Flag size={12} />
                        Bản cuối
                      </span>
                    ) : phase === "private" ? (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          action(
                            "select-final",
                            { id: s.id },
                            "Đã chọn bản nộp cuối.",
                          )
                        }
                      >
                        Chọn bản cuối
                      </button>
                    ) : null)}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6}>
                <div className="empty">
                  <UploadCloud size={30} />
                  <b>Chưa có bản nộp nào</b>
                  <span>
                    Bắt đầu bằng một baseline hợp lệ. Mỗi lượt nộp là một lần
                    học.
                  </span>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => go("overview")}>
          <span className="brand-symbol">
            A<span>·</span>
          </span>
          <span>
            olpai<span className="brand-light">arena</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="status-dot" /> KHÔNG GIAN LUYỆN THI
        </div>
        <nav aria-label="Điều hướng chính">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={section === n.id ? "nav-link active" : "nav-link"}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "submit" && open ? <span className="nav-dot" /> : null}
            </button>
          ))}
          {isAdmin && (
            <>
              <div className="nav-divider" />
              <button
                className={`nav-link ${section === "admin" ? "active" : ""}`}
                onClick={() => go("admin")}
              >
                <ShieldCheck size={19} />
                Quản trị viên
              </button>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="practice-note">
            <FlaskConical size={18} />
            <b>Luyện tập có chủ đích</b>
            <p>
              Nộp sớm. Đo trước.
              <br />
              Cải tiến có kiểm chứng.
            </p>
          </div>
          <button className="user-card" onClick={() => go("settings")}>
            <span className="avatar">
              {data.user.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <b>{data.user.name}</b>
              <small>
                {isAdmin
                  ? "Quản trị viên"
                  : (data.team?.name ?? "Chưa tham gia đội")}
              </small>
            </span>
            <Settings2 size={16} />
          </button>
          <button
            className="logout"
            onClick={async () => {
              await api("auth/logout", {});
              window.location.href = "/login";
            }}
          >
            <LogOut size={15} />
            Đăng xuất
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumbs">
            Mùa luyện 2026 <ChevronRight size={14} />
            <span>{title}</span>
          </div>
          <div className="topbar-right">
            <button
              className="icon-btn"
              title="Tài khoản"
              aria-label="Tài khoản"
              onClick={() => go("settings")}
            >
              <Settings2 size={17} />
            </button>
            <span className={`live-indicator ${open ? "is-live" : ""}`}>
              <i />
              {phaseNames[phase]}
            </span>
            <button
              className="icon-btn"
              title="Làm mới dữ liệu"
              aria-label="Làm mới dữ liệu"
              onClick={load}
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-btn"
              title="Xem thông báo"
              aria-label="Xem thông báo"
              onClick={() => {
                go("overview");
                setToast(
                  data.announcements[0]?.text ?? "Chưa có thông báo mới.",
                );
              }}
            >
              <Bell size={18} />
            </button>
            <span className="avatar small">
              {data.user.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <main className="content">
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button aria-label="Đóng lỗi" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {toast && (
            <div className="toast" role="status">
              <CheckCircle2 size={18} />
              {toast}
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow muted">OLYMPIC AI · MOCK CONTEST</span>
              <h1>
                {section === "overview" ? "Đấu trường của bạn" : title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {section === "overview"
                  ? "Cùng đồng đội biến mỗi buổi luyện thành một bước tiến."
                  : section === "admin"
                    ? "Một tài khoản điều hành. Mọi mốc giờ được thực thi trên máy chủ."
                    : section === "team"
                      ? "Kết nối đồng đội, chia sẻ một hành trình và cùng chinh phục đề thi."
                      : "Tập trung vào điều quan trọng: thử nghiệm, đánh giá và tiến bộ."}
              </p>
            </div>
            <span className="season-tag">
              <FlaskConical size={15} />
              BỘ MÔ PHỎNG 2026
            </span>
          </div>
          {section === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <div className="hero-tags">
                    <span className="pill hero-pill">
                      <span className="status-dot" />
                      {phaseNames[phase]}
                    </span>
                    <span>VÒNG LUYỆN · {c.id.slice(0, 6).toUpperCase()}</span>
                  </div>
                  <h2>{c.title}</h2>
                  <p>
                    {phase === "private"
                      ? "Giờ cuối đã bắt đầu. Tập trung tái tạo và chọn bản nộp cuối cho từng tác vụ."
                      : phase === "ended"
                        ? "Buổi luyện đã khép lại. Xem điểm private, phân tích kết quả và chuẩn bị lần tiếp theo."
                        : "Hai tác vụ. Một đường đua. Kiểm tra pipeline, chốt baseline và cải tiến từng bước."}
                  </p>
                  <div className="hero-meta">
                    <span>
                      <Clock3 size={16} />
                      {(c.publicSeconds + c.privateSeconds) / 3600} giờ thi
                    </span>
                    <span>
                      <Code2 size={17} />2 tác vụ
                    </span>
                    <span>
                      <Users size={17} />
                      Tối đa 3 thành viên
                    </span>
                  </div>
                  <button
                    className="btn orange-btn"
                    onClick={() =>
                      go(isAdmin ? "admin" : locked ? "team" : "statement")
                    }
                  >
                    {isAdmin
                      ? "Điều hành buổi thi"
                      : locked
                        ? "Chuẩn bị cùng đồng đội"
                        : "Vào làm bài"}
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="hero-timer">
                  <span className="eyebrow">
                    {phase === "scheduled"
                      ? "BẮT ĐẦU SAU"
                      : open
                        ? "THỜI GIAN CÒN LẠI"
                        : phase === "ended"
                          ? "HOÀN THÀNH BUỔI LUYỆN"
                          : "THỜI LƯỢNG BUỔI THI"}
                  </span>
                  <strong>
                    {phase === "ended" ? "00:00:00" : duration(remaining)}
                  </strong>
                  <p>
                    {phase === "public"
                      ? "Đến khi khóa public và mở private"
                      : phase === "private"
                        ? "Đến khi khóa toàn bộ bài nộp"
                        : c.startAt
                          ? `Bắt đầu ${when(c.startAt)} (UTC+7)`
                          : "Đồng hồ bắt đầu khi admin mở thi"}
                  </p>
                  <div className="timer-rule" />
                  <div className="timer-steps">
                    <span>
                      <i className="orange-dot" />
                      Public <b>{c.publicSeconds / 3600}h</b>
                    </span>
                    <ArrowRight size={14} />
                    <span>
                      <i />
                      Private <b>{c.privateSeconds / 3600}h</b>
                    </span>
                  </div>
                </div>
              </section>
              <div className="stat-grid">
                <Stat
                  icon={<Users size={20} />}
                  label="Đội của bạn"
                  value={data.team?.name ?? "Chưa có đội"}
                  caption={
                    data.team
                      ? `${data.team.members.length}/3 thành viên · Sẵn sàng phối hợp`
                      : "Tạo hoặc tham gia đội để nộp bài"
                  }
                />
                <Stat
                  icon={<Send size={20} />}
                  label="Bài nộp hợp lệ"
                  value={String(mySubs.length).padStart(2, "0")}
                  caption="Được lưu theo đội trong buổi hiện tại"
                />
                <Stat
                  icon={<Trophy size={20} />}
                  label="Điểm public của đội"
                  value={fmt(
                    data.leaderboard.public.find(
                      (r) => r.teamId === data.user.teamId,
                    )?.total,
                  )}
                  caption="Trung bình điểm tốt nhất của 2 tác vụ"
                />
              </div>
              <section className="panel schedule-panel">
                <div className="section-title">
                  <h2>
                    <Clock3 size={18} />
                    Lộ trình buổi thi
                  </h2>
                  <span className="muted">Tự động chuyển giai đoạn</span>
                </div>
                <div className="timeline">
                  {[
                    {
                      n: "01",
                      title: "Chuẩn bị",
                      caption: "Lập đội · Kiểm tra môi trường",
                      active: ["waiting", "scheduled"].includes(phase),
                    },
                    {
                      n: "02",
                      title: "Public",
                      caption: `${c.publicSeconds / 3600} giờ · ${c.publicLimit} lượt / tác vụ`,
                      active: phase === "public",
                    },
                    {
                      n: "03",
                      title: "Private",
                      caption: `${c.privateSeconds / 3600} giờ · ${c.privateLimit} lượt / tác vụ`,
                      active: phase === "private",
                    },
                    {
                      n: "04",
                      title: "Tổng kết",
                      caption: "Công bố điểm · Phân tích lỗi",
                      active: phase === "ended",
                    },
                  ].map((s) => (
                    <div
                      className={
                        s.active ? "timeline-step current" : "timeline-step"
                      }
                      key={s.n}
                    >
                      <span className="step-number">
                        {s.active ? <Radio size={16} /> : s.n}
                      </span>
                      <div>
                        <b>{s.title}</b>
                        <small>{s.caption}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <div className="section-title outside">
                <div>
                  <h2>Hai thử thách, một mục tiêu</h2>
                  <p className="muted">
                    Xây pipeline vững trước khi tăng độ phức tạp.
                  </p>
                </div>
                <button className="text-button" onClick={() => go("statement")}>
                  Xem toàn bộ đề <ArrowRight size={15} />
                </button>
              </div>
              <div className="task-grid">{taskCards}</div>
              <div className="lower-grid">
                <section className="panel">
                  <div className="section-title">
                    <h2>
                      <Bell size={18} />
                      Bảng tin
                    </h2>
                    <span className="pill neutral">
                      {data.announcements.length} thông báo
                    </span>
                  </div>
                  {data.announcements.length ? (
                    data.announcements.map((a) => (
                      <div className="announcement" key={a.id}>
                        <span className="announcement-icon">
                          <Flag size={16} />
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
                        <Sparkles size={18} />
                      </span>
                      <div>
                        <b>Mọi thứ bắt đầu từ một baseline</b>
                        <p>
                          Chuẩn bị môi trường trước giờ thi. Đề và dữ liệu sẽ mở
                          khi admin bắt đầu.
                        </p>
                      </div>
                    </div>
                  )}
                </section>
                <section className="panel quick-rules">
                  <div className="section-title">
                    <h2>
                      <ShieldCheck size={18} />
                      Nhớ trước khi nộp
                    </h2>
                  </div>
                  <p>
                    <Check size={16} />
                    CSV UTF-8, đúng schema và đầy đủ ID.
                  </p>
                  <p>
                    <Check size={16} />
                    Public trả điểm ngay; private ẩn đến hết giờ.
                  </p>
                  <p>
                    <Check size={16} />
                    Không dùng test để train hoặc tự gán nhãn.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => go("statement")}
                  >
                    Đọc quy định mô phỏng <ArrowUpRight size={14} />
                  </button>
                </section>
              </div>
            </>
          )}
          {section === "statement" &&
            (locked ? (
              <Locked
                title="Đề thi chưa được mở"
                text="Đề thi sẽ xuất hiện khi admin bắt đầu hoặc đến giờ đã hẹn. Bạn có thể lập đội và chuẩn bị môi trường trước."
              />
            ) : (
              <section className="panel statement-panel">
                <div className="statement-head">
                  <span className="pill green">
                    <BookOpen size={14} />
                    BỘ ĐỀ {data.packageVersion ?? "CHƯA NẠP"}
                  </span>
                  <button className="btn small-btn" onClick={() => go("data")}>
                    <ArrowDownToLine size={15} />
                    Tải đề & dữ liệu
                  </button>
                </div>
                <div className="prose">
                  {statement ? (
                    <Markdown remarkPlugins={[remarkGfm]}>
                      {statement.replaceAll("<!-- PAGE -->", "")}
                    </Markdown>
                  ) : (
                    <p>Đang tải nội dung đề…</p>
                  )}
                </div>
              </section>
            ))}
          {section === "data" && (
            <>
              <div className="info-strip">
                <ShieldCheck size={18} />
                <p>
                  Đầu vào test không chứa nhãn. Đáp án được giữ riêng trên máy
                  chủ. Gói private mở ở giờ cuối.
                </p>
              </div>
              {locked ? (
                <Locked
                  title="Tài nguyên đang được niêm phong"
                  text="Các liên kết tải được cấp theo quyền truy cập và thời gian trên máy chủ."
                />
              ) : (
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
                      <p>{a.description}</p>
                      <div className="asset-size">
                        {bytes(a.bytes)} · SHA-256 đi kèm
                      </div>
                      <details>
                        <summary>Xem checksum</summary>
                        <code>{a.sha256}</code>
                      </details>
                      <a
                        className="btn"
                        href={`/api/download?asset=${encodeURIComponent(a.key)}`}
                      >
                        <ArrowDownToLine size={16} />
                        Tải xuống
                        <ArrowUpRight size={15} />
                      </a>
                    </article>
                  ))}
                </div>
              )}
              <div className="panel note-panel">
                <h3>
                  <Code2 size={18} />
                  Môi trường trước giờ thi
                </h3>
                <p>
                  Gói contestant chứa dữ liệu train/validation, public input,
                  notebook, baseline CPU/học sâu và checkpoint gốc được phép.
                  Cài thư viện và kiểm tra GPU trước buổi thi. Private chỉ chứa
                  đầu vào cho giờ cuối.
                </p>
                <p>
                  Liên kết tải có hạn 1 phút để bắt đầu tải. Tệp đã tải sẽ tiếp
                  tục nằm trên máy của bạn; hệ thống chỉ kiểm soát việc cấp liên
                  kết mới.
                </p>
              </div>
            </>
          )}
          {section === "submit" && (
            <>
              <div className="submission-grid">
                <section className="panel">
                  <div className="section-title">
                    <h2>
                      <UploadCloud size={19} />
                      Nộp dự đoán
                    </h2>
                    <span className={`pill ${open ? "green" : "neutral"}`}>
                      {phaseNames[phase]}
                    </span>
                  </div>
                  {isAdmin ? (
                    <div className="empty compact">
                      <ShieldCheck size={30} />
                      <b>Chế độ giám sát</b>
                      <span>
                        Admin xem được đề và tài nguyên mọi lúc. Dùng tài khoản
                        thí sinh để tham gia chấm điểm.
                      </span>
                    </div>
                  ) : !open ? (
                    <Locked
                      title={
                        phase === "ended"
                          ? "Đã khóa toàn bộ bài nộp"
                          : "Chưa đến thời gian nộp"
                      }
                      text="Bài nộp được nhận theo đồng hồ máy chủ. Lịch sử vẫn được lưu sau khi hết giờ."
                    />
                  ) : !data.team ? (
                    <div className="empty compact">
                      <Users size={30} />
                      <b>Tham gia một đội để nộp bài</b>
                      <button
                        className="btn primary"
                        onClick={() => go("team")}
                      >
                        Tạo hoặc tham gia đội
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={upload} className="upload-form">
                      <label>
                        Tác vụ
                        <select
                          value={task}
                          onChange={(e) => {
                            setTask(e.target.value as TaskId);
                            submissionNonce.current = crypto.randomUUID();
                          }}
                        >
                          <option value="1">01 · Tách từng nhân tế bào</option>
                          <option value="2">
                            02 · Đọc hiểu & biết từ chối
                          </option>
                        </select>
                      </label>
                      <div className="schema-line">
                        <code>
                          {task === "1"
                            ? "ImageId,EncodedPixels"
                            : "id,prediction"}
                        </code>
                        <span>
                          {count}/{quota} lượt đã dùng
                        </span>
                      </div>
                      <label className="dropzone">
                        <UploadCloud size={32} />
                        <b>Chọn tệp dự đoán của bạn</b>
                        <span>CSV UTF-8 · Tối đa 3 MB</span>
                        <input
                          ref={fileInput}
                          type="file"
                          name="file"
                          accept=".csv,text/csv"
                          required
                          onChange={() => {
                            submissionNonce.current = crypto.randomUUID();
                          }}
                        />
                      </label>
                      <label>
                        Ghi chú thí nghiệm{" "}
                        <span className="muted">(không bắt buộc)</span>
                        <input
                          name="note"
                          maxLength={300}
                          placeholder="Ví dụ: U-Net, threshold 0.45, watershed v2"
                        />
                      </label>
                      <button
                        className="btn primary wide"
                        disabled={busy || count >= quota}
                        type="submit"
                      >
                        {busy
                          ? "Đang kiểm tra và chấm bài…"
                          : count >= quota
                            ? "Đã hết lượt nộp"
                            : "Nộp bài " + phase}
                        <Send size={16} />
                      </button>
                      <small>
                        Bài lỗi định dạng không trừ quota. Lượt nộp chỉ được ghi
                        nhận nếu chấm xong trước khi giai đoạn đóng.
                      </small>
                    </form>
                  )}
                </section>
                <aside className="panel submit-help">
                  <span className="eyebrow muted">QUY TRÌNH CHẤM</span>
                  <h3>Mỗi lượt nộp đều có ý nghĩa.</h3>
                  <div>
                    <span>01</span>
                    <p>
                      <b>Kiểm tra định dạng</b>Đúng cột, đủ ID, không trùng hoặc
                      vượt giới hạn.
                    </p>
                  </div>
                  <div>
                    <span>02</span>
                    <p>
                      <b>Chấm bằng nhãn giữ kín</b>Instance AP cho ảnh; token F1
                      và EM cho đọc hiểu.
                    </p>
                  </div>
                  <div>
                    <span>03</span>
                    <p>
                      <b>Ghi nhận theo đội</b>Public chọn điểm tốt nhất. Private
                      mặc định bản mới nhất; bạn có thể chọn lại trước hết giờ.
                    </p>
                  </div>
                  <div className="info-strip">
                    <LockKeyhole size={17} />
                    <p>
                      Điểm private được ẩn ở cả lịch sử và bảng xếp hạng cho đến
                      khi kết thúc.
                    </p>
                  </div>
                </aside>
              </div>
              <section className="panel">
                <div className="section-title">
                  <h2>
                    <Activity size={18} />
                    {isAdmin ? "Tất cả bản nộp" : "Lịch sử nộp của đội"}
                  </h2>
                  <button className="text-button" onClick={load}>
                    Làm mới <RefreshCw size={14} />
                  </button>
                </div>
                {history}
              </section>
            </>
          )}
          {section === "leaderboard" && (
            <>
              <div className="board-banner">
                <div className="trophy-illustration">
                  <Trophy size={45} />
                </div>
                <div>
                  <span className="eyebrow muted">CÙNG NHAU TIẾN BỘ</span>
                  <h2>Chạy đua với chính mình.</h2>
                  <p>
                    Điểm tổng là trung bình 2 tác vụ, trên thang 100. Tác vụ
                    chưa nộp tính 0.
                  </p>
                </div>
              </div>
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
                      Private{" "}
                      {phase !== "ended" && !isAdmin && (
                        <LockKeyhole size={13} />
                      )}
                    </button>
                  </div>
                  <span className="muted">Cập nhật mỗi 30 giây</span>
                </div>
                {board === "private" && !data.leaderboard.private ? (
                  <Locked
                    title="Bảng điểm private đang được giữ kín"
                    text="Bảng điểm cuối được công bố khi kết thúc, dựa trên bản nộp private được chọn cho từng tác vụ."
                  />
                ) : (
                  <div className="table-scroll">
                    <table className="leaderboard">
                      <thead>
                        <tr>
                          <th>Hạng</th>
                          <th>Đội thi</th>
                          <th>{locked ? "Tác vụ 01" : "Instance AP"}</th>
                          <th>{locked ? "Tác vụ 02" : "Token F1"}</th>
                          <th>Tổng điểm</th>
                          <th>Lượt nộp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.leaderboard[board] ?? []).length ? (
                          (data.leaderboard[board] ?? []).map((r) => (
                            <tr
                              key={r.teamId}
                              className={
                                r.teamId === data.user.teamId ? "my-team" : ""
                              }
                            >
                              <td>
                                <span className={`rank rank-${r.rank}`}>
                                  {r.rank <= 3 ? <Medal size={19} /> : null}
                                  {r.rank}
                                </span>
                              </td>
                              <td>
                                <b>{r.name}</b>
                                {r.teamId === data.user.teamId && (
                                  <span className="pill green">Đội bạn</span>
                                )}
                              </td>
                              <td className="mono">{fmt(r.task1)}</td>
                              <td className="mono">{fmt(r.task2)}</td>
                              <td className="total-score mono">
                                {fmt(r.total)}
                              </td>
                              <td>{r.submitted}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6}>
                              <div className="empty">
                                <Trophy size={32} />
                                <b>Đường đua đang chờ những điểm số đầu tiên</b>
                                <span>
                                  Chỉ đội đã có bản nộp hợp lệ xuất hiện trên
                                  bảng.
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <p className="footnote">
                Điểm xếp hạng dùng giá trị đầy đủ; giao diện làm tròn 2 chữ số.
                Nếu bằng tổng, ưu tiên EM tác vụ 2, rồi thời điểm bản nộp sớm
                hơn. Public dùng bản tốt nhất; private dùng bản được chọn (mặc
                định bản hợp lệ mới nhất).
              </p>
            </>
          )}
          {section === "team" && (
            <>
              {data.team ? (
                <div className="team-grid">
                  <section className="panel team-panel">
                    <div className="team-heading">
                      <span className="team-emblem">
                        <Users size={32} />
                      </span>
                      <div>
                        <span className="eyebrow muted">ĐỘI CỦA BẠN</span>
                        <h2>{data.team.name}</h2>
                        <p>{data.team.members.length}/3 thành viên</p>
                      </div>
                    </div>
                    {data.team.members.map((m) => (
                      <div className="member" key={m.id}>
                        <span className="avatar">
                          {m.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <b>
                            {m.name}
                            {m.id === data.user.id ? " (bạn)" : ""}
                          </b>
                          <small>@{m.username}</small>
                        </span>
                        <span className="pill neutral">
                          {m.id === data.team?.captainId
                            ? "Đội trưởng"
                            : "Thành viên"}
                        </span>
                      </div>
                    ))}
                    <button
                      className="btn danger-ghost"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Rời đội hiện tại? Điểm và quota đã dùng vẫn thuộc về đội này.",
                          )
                        )
                          void action(
                            "team",
                            { action: "leave" },
                            "Đã rời đội.",
                          );
                      }}
                    >
                      Rời đội
                    </button>
                  </section>
                  <section className="panel">
                    <h3>Mời đồng đội</h3>
                    <p className="muted">
                      Chia sẻ mã để bạn bè tham gia, hoặc gửi lời mời đến tài
                      khoản của họ.
                    </p>
                    <div className="invite-code">
                      <code>{data.team.inviteCode}</code>
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              data.team!.inviteCode,
                            );
                            setToast("Đã sao chép mã mời.");
                          } catch {
                            setToast("Hãy chọn và sao chép mã mời hiển thị.");
                          }
                        }}
                      >
                        Sao chép
                      </button>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(
                          "team",
                          {
                            action: "invite",
                            username: new FormData(e.currentTarget).get(
                              "username",
                            ),
                          },
                          "Đã gửi lời mời trong ứng dụng.",
                        );
                      }}
                    >
                      <label>
                        Tên đăng nhập
                        <input
                          name="username"
                          placeholder="username_cua_dong_doi"
                          required
                        />
                      </label>
                      <button className="btn primary" disabled={busy}>
                        <Send size={15} />
                        Gửi lời mời
                      </button>
                    </form>
                  </section>
                </div>
              ) : (
                <div className="team-grid">
                  <section className="panel">
                    <div className="section-title">
                      <h2>
                        <Plus size={20} />
                        Tạo đội mới
                      </h2>
                    </div>
                    <p className="muted">
                      Một người cũng có thể lập đội và bắt đầu. Mời thêm đồng
                      đội khi sẵn sàng.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(
                          "team",
                          {
                            action: "create",
                            name: new FormData(e.currentTarget).get("name"),
                          },
                          "Đã tạo đội. Chia sẻ mã mời với đồng đội nhé.",
                        );
                      }}
                    >
                      <label>
                        Tên đội
                        <input
                          name="name"
                          required
                          minLength={2}
                          maxLength={50}
                          placeholder="Đặt tên cho đội của bạn"
                        />
                      </label>
                      <button className="btn primary" disabled={busy}>
                        <Plus size={16} />
                        Tạo đội
                      </button>
                    </form>
                  </section>
                  <section className="panel">
                    <div className="section-title">
                      <h2>
                        <Users size={20} />
                        Tham gia bằng mã mời
                      </h2>
                    </div>
                    <p className="muted">
                      Nhận mã mời từ một thành viên. Mỗi đội tối đa 3 tài khoản
                      cá nhân.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(
                          "team",
                          {
                            action: "join",
                            code: new FormData(e.currentTarget).get("code"),
                          },
                          "Đã tham gia đội.",
                        );
                      }}
                    >
                      <label>
                        Mã mời
                        <input
                          name="code"
                          required
                          placeholder="Nhập mã mời của đội"
                        />
                      </label>
                      <button className="btn" disabled={busy}>
                        Tham gia đội
                        <ArrowRight size={16} />
                      </button>
                    </form>
                  </section>
                </div>
              )}
              {data.invites.length > 0 && (
                <section className="panel">
                  <h3>Lời mời của bạn</h3>
                  {data.invites.map((t) => (
                    <div className="member" key={t.id}>
                      <span>
                        <b>{t.name}</b>
                        <small>Mời bạn tham gia đội</small>
                      </span>
                      <button
                        className="btn small-btn"
                        disabled={busy}
                        onClick={() =>
                          action(
                            "team",
                            { action: "join", teamId: t.id },
                            "Đã tham gia đội.",
                          )
                        }
                      >
                        Chấp nhận
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          action("team", { action: "decline", teamId: t.id })
                        }
                      >
                        Từ chối
                      </button>
                    </div>
                  ))}
                </section>
              )}
              <div className="info-strip">
                <Users size={18} />
                <p>
                  Có thể thay đổi thành viên trong lúc thi. Lịch sử, điểm và
                  quota gắn với đội đã nộp, không di chuyển theo tài khoản. Mọi
                  thành viên trong đội đều có thể nộp và chọn bản cuối.
                </p>
              </div>
            </>
          )}
          {section === "settings" && (
            <section className="panel narrow-panel">
              <h2>Đổi mật khẩu</h2>
              <p className="muted">
                Tài khoản @{data.user.username} ·{" "}
                {isAdmin ? "Quản trị viên duy nhất" : "Thí sinh"}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action(
                    "password",
                    Object.fromEntries(f),
                    "Đã đổi mật khẩu.",
                  );
                  e.currentTarget.reset();
                }}
              >
                <label>
                  Mật khẩu hiện tại
                  <input
                    type="password"
                    name="current"
                    required
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  Mật khẩu mới
                  <input
                    type="password"
                    name="password"
                    minLength={10}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <button className="btn primary" disabled={busy}>
                  Lưu mật khẩu mới
                  <ShieldCheck size={16} />
                </button>
              </form>
              <button
                className="btn danger-ghost"
                style={{ marginTop: 20 }}
                onClick={async () => {
                  await api("auth/logout", {});
                  window.location.href = "/login";
                }}
              >
                <LogOut size={16} />
                Đăng xuất
              </button>
            </section>
          )}
          {section === "admin" &&
            (isAdmin ? (
              <>
                <div className="info-strip">
                  <ShieldCheck size={18} />
                  <p>
                    Bạn là quản trị viên duy nhất. Lịch tự chuyển dựa trên thời
                    gian Redis, kể cả khi không ai mở website.
                  </p>
                </div>
                <div className="admin-grid">
                  <section className="panel">
                    <div className="section-title">
                      <h2>
                        <Play size={19} />
                        Điều khiển buổi thi
                      </h2>
                      <span className="pill green">{phaseNames[phase]}</span>
                    </div>
                    <div className="admin-clock mono">
                      {duration(remaining)}
                    </div>
                    <p className="muted">
                      {c.startAt
                        ? `Bắt đầu: ${when(c.startAt)} · Mở private: ${when(publicEnd!)} · Kết thúc: ${when(end!)} (UTC+7)`
                        : "Chưa có thời điểm bắt đầu."}
                    </p>
                    <div className="action-row">
                      {["waiting", "scheduled"].includes(phase) && (
                        <button
                          className="btn primary"
                          disabled={busy || !data.ready}
                          onClick={() => {
                            if (
                              confirm(
                                "Bắt đầu ngay? Đề và gói public sẽ được mở cho mọi thí sinh.",
                              )
                            )
                              void action(
                                "admin/control",
                                { action: "start" },
                                "Buổi thi đã bắt đầu.",
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
                          onClick={() =>
                            action("admin/control", { action: "cancel" })
                          }
                        >
                          Hủy lịch hẹn
                        </button>
                      )}
                      {open && (
                        <button
                          className="btn danger-ghost"
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                "Kết thúc sớm và công bố điểm private ngay? Tất cả bài nộp sẽ bị khóa.",
                              )
                            )
                              void action(
                                "admin/control",
                                { action: "finish" },
                                "Đã kết thúc buổi thi.",
                              );
                          }}
                        >
                          Kết thúc sớm
                        </button>
                      )}
                      {phase === "ended" && (
                        <button
                          className="btn primary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                "Tạo buổi luyện mới? Kết quả buổi cũ được lưu, buổi mới có quota riêng.",
                              )
                            )
                              void action(
                                "admin/control",
                                { action: "new" },
                                "Đã tạo buổi luyện mới.",
                              );
                          }}
                        >
                          <Plus size={16} />
                          Tạo buổi luyện mới
                        </button>
                      )}
                    </div>
                    {["waiting", "scheduled"].includes(phase) && (
                      <form
                        className="schedule-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const v = new FormData(e.currentTarget).get(
                            "scheduledAt",
                          ) as string;
                          void action(
                            "admin/control",
                            {
                              action: "schedule",
                              scheduledAt: new Date(v + "+07:00").toISOString(),
                            },
                            "Đã hẹn giờ bắt đầu.",
                          );
                        }}
                      >
                        <label>
                          Hẹn giờ bắt đầu (giờ Việt Nam, UTC+7)
                          <input
                            type="datetime-local"
                            name="scheduledAt"
                            required
                          />
                        </label>
                        <button className="btn" disabled={busy || !data.ready}>
                          <Clock3 size={16} />
                          Lưu lịch hẹn
                        </button>
                      </form>
                    )}
                  </section>
                  <section className="panel">
                    <h3>Cấu hình mô phỏng</h3>
                    <form
                      key={`${c.id}-${c.publicSeconds}-${c.privateSeconds}`}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void action("admin/control", {
                          action: "configure",
                          title: f.get("title"),
                          publicSeconds: Number(f.get("publicMinutes")) * 60,
                          privateSeconds: Number(f.get("privateMinutes")) * 60,
                          publicLimit: Number(f.get("publicLimit")),
                          privateLimit: Number(f.get("privateLimit")),
                        });
                      }}
                    >
                      <fieldset
                        disabled={
                          busy || !["waiting", "scheduled"].includes(phase)
                        }
                      >
                        <label>
                          Tên buổi thi
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
                              type="number"
                              name="publicMinutes"
                              min="0.5"
                              max="720"
                              step="0.5"
                              defaultValue={c.publicSeconds / 60}
                            />
                          </label>
                          <label>
                            Private (phút)
                            <input
                              type="number"
                              name="privateMinutes"
                              min="0.5"
                              max="120"
                              step="0.5"
                              defaultValue={c.privateSeconds / 60}
                            />
                          </label>
                          <label>
                            Quota public / tác vụ
                            <input
                              name="publicLimit"
                              type="number"
                              min="1"
                              max="100"
                              defaultValue={c.publicLimit}
                            />
                          </label>
                          <label>
                            Quota private / tác vụ
                            <input
                              name="privateLimit"
                              type="number"
                              min="1"
                              max="20"
                              defaultValue={c.privateLimit}
                            />
                          </label>
                        </div>
                        <button className="btn">
                          <Settings2 size={15} />
                          Lưu cấu hình
                        </button>
                      </fieldset>
                    </form>
                    <p className="footnote">
                      Mặc định 300 + 60 phút, 20 + 5 lượt. Có thể rút ngắn để
                      kiểm tra luồng. Đây là quy ước luyện tập của đội.
                    </p>
                  </section>
                </div>
                <div className="admin-grid">
                  <section className="panel">
                    <h3>Gửi thông báo trong đấu trường</h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(
                          "admin/control",
                          {
                            action: "announce",
                            text: new FormData(e.currentTarget).get("text"),
                          },
                          "Đã đăng thông báo.",
                        );
                        e.currentTarget.reset();
                      }}
                    >
                      <label>
                        Nội dung
                        <textarea
                          name="text"
                          maxLength={1000}
                          required
                          placeholder="Ví dụ: Đội kiểm tra lại entrypoint inference trước khi vào giờ private."
                        />
                      </label>
                      <button className="btn primary" disabled={busy}>
                        <Bell size={16} />
                        Đăng thông báo
                      </button>
                    </form>
                  </section>
                  <section className="panel">
                    <h3>Trạng thái hệ thống</h3>
                    <div className="system-row">
                      <span>Bộ đề & bộ chấm</span>
                      <span
                        className={`pill ${data.ready ? "green" : "neutral"}`}
                      >
                        {data.ready ? "Đã nạp" : "Chưa nạp"}
                      </span>
                    </div>
                    <div className="system-row">
                      <span>Phiên bản</span>
                      <code>{data.packageVersion ?? "—"}</code>
                    </div>
                    <div className="system-row">
                      <span>Đội / bản nộp</span>
                      <b>
                        {data.teams?.length ?? 0} / {data.submissions.length}
                      </b>
                    </div>
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          const result = await api("admin/export", {});
                          const url = URL.createObjectURL(
                            new Blob([JSON.stringify(result, null, 2)], {
                              type: "application/json",
                            }),
                          );
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `arena-${c.id}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <ArrowDownToLine size={16} />
                      Xuất kết quả JSON
                    </button>
                    <p className="footnote">
                      Mã nguồn, trọng số và báo cáo cuối: nộp riêng cho người
                      coi thi. Website chỉ chấm CSV dự đoán, không chạy mã thí
                      sinh.
                    </p>
                  </section>
                </div>
              </>
            ) : (
              <Locked
                title="Khu vực quản trị"
                text="Tài khoản của bạn không có quyền điều hành buổi thi."
              />
            ))}
          <footer className="page-footer">
            <span>
              olpai arena <b>·</b> Không gian mô phỏng độc lập
            </span>
            <span>
              Build. Validate. Submit.
              <span className="status-dot" />
            </span>
          </footer>
        </main>
      </div>
    </div>
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
  caption: string;
}) {
  return (
    <article className="stat-card">
      <span className="stat-icon">{icon}</span>
      <div>
        <span className="stat-label">{label}</span>
        <strong>{value}</strong>
        <small>{caption}</small>
      </div>
    </article>
  );
}
function Locked({ title, text }: { title: string; text: string }) {
  return (
    <div className="locked">
      <span className="lock-circle">
        <LockKeyhole size={26} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      <span className="pill neutral">
        <Clock3 size={13} />
        Đồng bộ theo giờ máy chủ
      </span>
    </div>
  );
}
