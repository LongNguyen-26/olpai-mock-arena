"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trophy,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import {
  api,
  endpoint,
  when,
  type Action,
  type ArenaData,
} from "./arena-client";
import { phaseOf } from "@/lib/domain";
import RoundAdmin, { PublishRound } from "./round-admin";
import { ProfileView, signOut, TeamView } from "./team-profile";
import {
  OverviewView,
  StatementView,
  DataView,
  SubmitView,
  BoardView,
} from "./round-views";
type Section =
  | "rounds"
  | "overview"
  | "statement"
  | "data"
  | "submit"
  | "leaderboard"
  | "team"
  | "settings"
  | "admin";
const labels: Record<Section, string> = {
  rounds: "Vòng luyện",
  overview: "Tổng quan",
  statement: "Đề thi",
  data: "Dữ liệu",
  submit: "Nộp bài",
  leaderboard: "Bảng xếp hạng",
  team: "Đội của tôi",
  settings: "Tài khoản",
  admin: "Quản trị vòng luyện",
};
const nav = [
  { id: "overview", icon: LayoutDashboard },
  { id: "statement", icon: BookOpen },
  { id: "data", icon: Database },
  { id: "submit", icon: UploadCloud },
  { id: "leaderboard", icon: Trophy },
] as const;
export const names = {
  waiting: "Chưa mở",
  scheduled: "Đã hẹn giờ",
  public: "Đang nhận public",
  private: "Đang nhận private",
  ended: "Đã kết thúc",
};
export default function Arena() {
  const [data, setData] = useState<ArenaData | null>(null),
    [section, setSection] = useState<Section>("rounds"),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [clock, setClock] = useState(Date.now()),
    [offset, setOffset] = useState(0);
  const selected = useRef(""),
    sequence = useRef(0),
    controller = useRef<AbortController | null>(null);
  const load = useCallback(async (id = selected.current) => {
    const seq = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const started = Date.now();
      const response = await fetch(endpoint("arena", id), {
        cache: "no-store",
        signal: abort.signal,
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      if (seq === sequence.current) {
        setData(next);
        setOffset(next.serverNow - (started + Date.now()) / 2);
      }
    } catch (e) {
      if (
        !(e instanceof DOMException && e.name === "AbortError") &&
        seq === sequence.current
      )
        setError(e instanceof Error ? e.message : "Không thể tải dữ liệu.");
    }
  }, []);
  useEffect(() => {
    const read = () => {
      const url = new URL(window.location.href);
      selected.current = url.searchParams.get("round") ?? "";
      const s = url.hash.slice(1) as Section;
      setSection(s in labels ? s : selected.current ? "overview" : "rounds");
      void load();
    };
    read();
    const poll = setInterval(() => load(), 30000),
      tick = setInterval(() => setClock(Date.now()), 1000),
      focus = () => {
        void load();
      };
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    window.addEventListener("focus", focus);
    return () => {
      controller.current?.abort();
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("popstate", read);
      window.removeEventListener("hashchange", read);
      window.removeEventListener("focus", focus);
    };
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const c = data?.contest ?? null,
    phase = c ? phaseOf(c, clock + offset) : "waiting";
  useEffect(() => {
    if (c) void load();
  }, [phase, load]);
  function go(s: string, id = selected.current) {
    if (!(s in labels)) return;
    if (id !== selected.current) setData(null);
    selected.current = id;
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("round", id);
    else url.searchParams.delete("round");
    url.hash = s;
    window.history.pushState({}, "", url);
    setSection(s as Section);
    setError("");
    void load(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const action: Action = async (
    route,
    value,
    message = "Đã cập nhật.",
    target = selected.current,
  ) => {
    setBusy(true);
    setError("");
    try {
      await api(route, value, target);
      setToast(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <div className="loading-screen">
        <span className="brand-symbol">
          A<span>·</span>
        </span>
        <h2>Đang kết nối môi trường thi…</h2>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="btn" onClick={() => load()}>
              Thử lại
            </button>
            <a href="/login">Đăng nhập</a>
          </>
        ) : (
          <div className="loader" />
        )}
      </div>
    );
  const isAdmin = data.user.admin,
    inside = !!c && data.entered,
    open = inside && ["public", "private"].includes(phase),
    props = { data, busy, action },
    views = {
      ...props,
      phase,
      now: clock + offset,
      go,
      refresh: () => load(),
      report: setError,
    };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/#rounds"
          onClick={(e) => {
            e.preventDefault();
            go("rounds", "");
          }}
        >
          <span className="brand-symbol">
            A<span>·</span>
          </span>
          <span>
            olpai<span className="brand-light">arena</span>
          </span>
        </a>
        <nav className="arena-nav" aria-label="Điều hướng chính">
          <button
            className={`nav-link ${section === "rounds" ? "active" : ""}`}
            onClick={() => go("rounds", "")}
          >
            <Layers3 size={19} />
            Vòng luyện
          </button>
          {inside &&
            nav.map((n) => (
              <button
                key={n.id}
                className={`nav-link ${section === n.id ? "active" : ""}`}
                onClick={() => go(n.id)}
              >
                <n.icon size={19} />
                {labels[n.id]}
                {n.id === "submit" && open && section !== "submit" ? (
                  <span className="nav-dot" />
                ) : null}
              </button>
            ))}
          <div className="nav-divider" />
          <button
            className={`nav-link ${section === "team" ? "active" : ""}`}
            onClick={() => go("team")}
          >
            <Users size={19} />
            Đội của tôi
          </button>
          {inside && isAdmin && (
            <button
              className={`nav-link ${section === "admin" ? "active" : ""}`}
              onClick={() => go("admin")}
            >
              <ShieldCheck size={19} />
              Quản trị vòng
            </button>
          )}
          <button
            className={`nav-link ${section === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
          >
            <Settings2 size={19} />
            Tài khoản
          </button>
          <button className="nav-link" onClick={signOut}>
            <LogOut size={19} />
            Đăng xuất
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="user-card" onClick={() => go("settings")}>
            <span className="avatar">
              {data.user.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <b>{data.user.name}</b>
              <small>
                {isAdmin ? "Quản trị viên" : (data.team?.name ?? "Chưa có đội")}
              </small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumbs">
            Olympic AI 2026
            <ChevronRight size={16} />
            <span>{labels[section]}</span>
          </div>
          <div className="topbar-right">
            {c && (
              <span className={`live-indicator ${open ? "is-live" : ""}`}>
                <i />
                {names[phase]}
              </span>
            )}
            <button
              className="icon-btn"
              aria-label="Làm mới dữ liệu"
              onClick={() => load()}
            >
              <RefreshCw size={18} />
            </button>
            <button
              className="icon-btn"
              aria-label="Tài khoản"
              onClick={() => go("settings")}
            >
              <Settings2 size={18} />
            </button>
            <button
              className="icon-btn"
              aria-label="Đăng xuất"
              onClick={signOut}
            >
              <LogOut size={18} />
            </button>
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
              {c && inside && section !== "rounds" && (
                <button className="back-link" onClick={() => go("rounds", "")}>
                  <ArrowLeft size={14} />
                  Danh sách vòng luyện
                </button>
              )}
              <h1>{labels[section]}</h1>
              {c && section !== "rounds" && <p>{c.title}</p>}
            </div>
          </div>
          {section === "rounds" && (
            <>
              <div className="round-grid">
                {data.rounds.map((r) => (
                  <article className="panel round-card" key={r.id}>
                    <div className="section-title">
                      <span className="round-emblem">
                        <Layers3 size={25} />
                      </span>
                      <span
                        className={`pill ${["public", "private"].includes(r.phase) ? "green" : "neutral"}`}
                      >
                        {names[r.phase]}
                      </span>
                    </div>
                    <h2>{r.title}</h2>
                    <div className="round-meta">
                      <span>
                        <Clock3 size={17} />
                        {r.unlimited
                          ? "Không giới hạn"
                          : `${(r.publicSeconds + r.privateSeconds) / 3600} giờ`}
                      </span>
                      <span>
                        <BookOpen size={17} />2 tác vụ
                      </span>
                    </div>
                    {r.startAt && <p>Bắt đầu {when(r.startAt)}</p>}
                    <div className="round-card-footer">
                      {isAdmin ? (
                        <button
                          className="btn primary"
                          onClick={() => go("admin", r.id)}
                        >
                          Quản trị
                          <ArrowRight size={16} />
                        </button>
                      ) : r.registration?.status === "approved" ? (
                        <>
                          <span className="pill green">
                            <CheckCircle2 size={14} />
                            Đã đăng ký
                          </span>
                          <button
                            className="btn primary"
                            onClick={() => go("overview", r.id)}
                          >
                            Vào vòng luyện
                            <ArrowRight size={16} />
                          </button>
                        </>
                      ) : r.registration?.status === "pending" ? (
                        <span className="pill neutral">
                          Đăng ký đang chờ duyệt
                        </span>
                      ) : (
                        <button
                          className="btn primary"
                          disabled={busy}
                          onClick={() =>
                            action(
                              "round/register",
                              {},
                              r.autoApprove
                                ? "Đăng ký thành công."
                                : "Đã gửi đăng ký, chờ quản trị viên duyệt.",
                              r.id,
                            )
                          }
                        >
                          {r.registration?.status === "rejected"
                            ? "Đăng ký lại"
                            : "Đăng ký tham gia"}
                          <ArrowRight size={16} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {!data.rounds.length && (
                <Locked
                  title="Chưa có vòng luyện"
                  text="Vòng luyện sẽ xuất hiện sau khi quản trị viên phát hành."
                />
              )}
              {isAdmin && <PublishRound {...props} />}
            </>
          )}
          {c &&
            !inside &&
            !["rounds", "team", "settings"].includes(section) && (
              <Locked
                title={
                  data.registration?.status === "pending"
                    ? "Đăng ký đang chờ duyệt"
                    : "Đăng ký tham gia vòng luyện"
                }
                text="Đăng ký và được duyệt để vào vòng luyện."
              >
                <button
                  className="btn primary"
                  disabled={busy || data.registration?.status === "pending"}
                  onClick={() =>
                    action("round/register", {}, "Đã gửi đăng ký.")
                  }
                >
                  Đăng ký tham gia
                </button>
              </Locked>
            )}
          {inside && section === "overview" && <OverviewView {...views} />}{" "}
          {inside && section === "statement" && <StatementView {...views} />}{" "}
          {inside && section === "data" && <DataView {...views} />}{" "}
          {inside && section === "submit" && <SubmitView {...views} />}{" "}
          {inside && section === "leaderboard" && <BoardView {...views} />}
          {section === "team" && <TeamView {...props} />}{" "}
          {section === "settings" && <ProfileView {...props} />}{" "}
          {inside && isAdmin && section === "admin" && (
            <RoundAdmin {...props} />
          )}
        </main>
      </div>
    </div>
  );
}
export function Locked({
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
