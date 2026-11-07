"use client";
import BrandIdentity from "./brand-identity";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Cpu,
  Database,
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
import RoundAdmin from "./round-admin";
import GpuWorkspace from "./gpu-workspace";
import ArenaLoading from "./arena-loading";
import AdminRoster from "./admin-roster";
import RoundDirectory from "./round-directory";
import AuthRequired from "./auth-required";
import LockedResources from "./locked-resources";
import LegalLinks from "./legal-links";
import { loginHref, publicSections } from "@/lib/auth-navigation";
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
  | "workspace"
  | "people"
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
  workspace: "GPU Workspace",
  admin: "Quản trị vòng luyện",
  people: "Đội & thí sinh",
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
  public: "PUBLIC",
  private: "PRIVATE",
  practice: "Luyện tập tiếp",
  ended: "Đã kết thúc",
};
export default function Arena() {
  const [statementTask, setStatementTask] = useState("1");
  const [workspaceMounted, setWorkspaceMounted] = useState(false);
  const [slow, setSlow] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
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
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]);
    controller.current = abort;
    try {
      const started = Date.now();
      let response = await fetch(endpoint("arena", id), {
        cache: "no-store",
        signal,
      });
      let next = await response.json();
      if (response.status === 404 && id && seq === sequence.current) {
        selected.current = "";
        const url = new URL(window.location.href);
        url.searchParams.delete("round");
        url.hash = "rounds";
        window.history.replaceState({}, "", url);
        setSection("rounds");
        setData(null);
        setError(
          "Vòng luyện không còn hiển thị. Đã quay về danh sách vòng luyện.",
        );
        response = await fetch(endpoint("arena"), {
          cache: "no-store",
          signal,
        });
        next = await response.json();
      }
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
        setError(
          e instanceof DOMException && e.name === "TimeoutError"
            ? "Việc tải mất quá lâu. Vui lòng thử lại."
            : e instanceof Error
              ? e.message
              : "Không thể tải dữ liệu.",
        );
    }
  }, []);
  useEffect(() => {
    let active = true;
    const read = () => {
      const url = new URL(window.location.href);
      setStatementTask(url.searchParams.get("task") ?? "1");
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
    const navigation = () => {
      // Next.js may dispatch history events while restoring its router state.
      queueMicrotask(() => {
        if (active) read();
      });
    };
    window.addEventListener("popstate", navigation);
    window.addEventListener("hashchange", navigation);
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      controller.current?.abort();
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("popstate", navigation);
      window.removeEventListener("hashchange", navigation);
      window.removeEventListener("focus", focus);
    };
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (section === "workspace") setWorkspaceMounted(true);
  }, [section]);
  useEffect(() => {
    if (data) return;
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [data, bootAttempt]);
  const c = data?.contest ?? null,
    phase = c ? phaseOf(c, clock + offset) : "waiting";
  useEffect(() => {
    if (c) void load();
  }, [phase, load]);
  function go(s: string, id = selected.current, task?: string) {
    if (!(s in labels)) return;
    selected.current = id;
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("round", id);
    else url.searchParams.delete("round");
    if (s === "statement" && task) url.searchParams.set("task", task);
    else url.searchParams.delete("task");
    setStatementTask(task ?? "1");
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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Thao tác thất bại.");
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <ArenaLoading
        workspace={section === "workspace"}
        error={error}
        slow={slow}
        onRetry={() => {
          setSlow(false);
          setError("");
          setBootAttempt((n) => n + 1);
          void load();
        }}
      />
    );
  const isAdmin = !!data.user?.admin,
    guest = !data.user,
    needsLogin = guest && !publicSections.has(section),
    returnPath = `/${selected.current ? `?round=${encodeURIComponent(selected.current)}` : ""}#${section}`,
    transitioning = (c?.roundId ?? "") !== selected.current,
    inside = !!c && !transitioning,
    open = inside && ["public", "private", "practice"].includes(phase),
    props = { data, busy, action },
    views = {
      ...props,
      phase,
      now: clock + offset,
      go,
      statementTask,
      openTask: (task: string) => go("statement", selected.current, task),
      refresh: () => load(),
      report: setError,
    };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand" aria-label="OlpAI Arena — Trang chủ"
          href="/#rounds"
          onClick={(e) => {
            e.preventDefault();
            go("rounds", "");
          }}
        >
          <BrandIdentity />
        </a>
        <nav className="arena-nav" aria-label="Điều hướng chính">
          {inside &&
            nav.map((n) => (
              <button
                key={n.id}
                className={`nav-link ${section === n.id ? "active" : ""}`}
                onClick={() => go(n.id)}
              >
                <n.icon size={19} />
                {labels[n.id]}
                {n.id === "submit" &&
                !isAdmin &&
                open &&
                section !== "submit" ? (
                  <span className="nav-dot" />
                ) : null}
              </button>
            ))}
          <div className="nav-divider" />
          <button
            className={`nav-link ${section === "workspace" ? "active" : ""}`}
            onClick={() => go("workspace")}
          >
            <Cpu size={19} />
            GPU Workspace
          </button>
          {!isAdmin && (
            <button
              className={`nav-link ${section === "team" ? "active" : ""}`}
              onClick={() => go("team")}
            >
              <Users size={19} />
              Đội của tôi
            </button>
          )}
          {inside && isAdmin && (
            <button
              className={`nav-link admin-nav-link ${section === "admin" ? "active" : ""}`}
              onClick={() => go("admin")}
            >
              <ShieldCheck size={19} />
              Quản trị vòng
              {section !== "admin" && (
                <span
                  className="nav-dot admin-nav-dot"
                  aria-label="Khu vực quản trị"
                />
              )}
            </button>
          )}
          {isAdmin && (
            <button
              className={`nav-link ${section === "people" ? "active" : ""}`}
              onClick={() => go("people")}
            >
              <Users size={19} />
              Đội & thí sinh
            </button>
          )}
          <button
            className={`nav-link ${section === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
          >
            <Settings2 size={19} />
            Tài khoản
          </button>
          {!guest && <button className="nav-link" onClick={signOut}>
            <LogOut size={19} />
            Đăng xuất
          </button>}
        </nav>
        <div className="sidebar-bottom">
          <button className="user-card" onClick={() => go("settings")}>
            <span className="avatar">
              {data.user?.name.slice(0, 1).toUpperCase() ?? "K"}
            </span>
            <span>
              <b>{data.user?.name ?? "Khách"}</b>
              <small>
                {guest ? "OlpAI Arena" : isAdmin ? "Quản trị viên" : (data.team?.name ?? "Chưa có đội")}
              </small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumbs">
            <a
              href="/#rounds"
              onClick={(e) => {
                e.preventDefault();
                go("rounds", "");
              }}
            >
              {section !== "rounds" && (
                <ArrowLeft size={19} aria-hidden="true" />
              )}
              Các vòng luyện
            </a>
            {section !== "rounds" && (
              <div className="header-round-context">
                {inside && <strong title={c.title}>{c.title}</strong>}
                <span>{labels[section]}</span>
              </div>
            )}
          </div>
          <div className="topbar-right">
            {guest && <div className="guest-auth-actions">
              <a className="btn primary small-btn" href={loginHref(returnPath)}>Đăng nhập <ArrowRight size={15}/></a>
              <a className="btn small-btn guest-register" href={loginHref(returnPath,true)}>Tạo tài khoản</a>
            </div>}
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
            {!guest && <button
              className="icon-btn"
              aria-label="Đăng xuất"
              onClick={signOut}
            >
              <LogOut size={18} />
            </button>}
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
          {section !== "rounds" && <div className="page-heading">
            <div>
              <h1>{labels[section]}</h1>
              {inside && <p>{c.title}</p>}
            </div>
          </div>}
          {needsLogin && <AuthRequired section={section} next={returnPath} />}
          {section === "rounds" && <RoundDirectory {...props} now={clock+offset} onEnter={id=>go("overview",id)}/>}
          {transitioning && section !== "rounds" && (
            <div className="round-loading" role="status">
              <div className="loader" />
              Đang tải vòng luyện…
            </div>
          )}
          {inside &&
            !guest &&
            !data.entered &&
            ["overview", "data", "submit"].includes(section) && (
              <section className="panel registration-panel">
                <div>
                  <h2>
                    {data.registration?.status === "pending"
                      ? "Đăng ký đang chờ duyệt"
                      : "Tham gia vòng luyện"}
                  </h2>
                  <p>
                    Đăng ký để tải dữ liệu và nộp bài khi vòng luyện mở. Đề đã công bố và bảng xếp hạng có thể xem ngay.
                  </p>
                </div>
                <button
                  className="btn primary"
                  disabled={busy || data.registration?.status === "pending"}
                  onClick={() =>
                    action(
                      "round/register",
                      {},
                      c.autoApprove !== false
                        ? "Đăng ký thành công."
                        : "Đã gửi đăng ký, chờ duyệt.",
                    )
                  }
                >
                  {data.registration?.status === "pending"
                    ? "Chờ duyệt"
                    : data.registration?.status === "rejected"
                      ? "Đăng ký lại"
                      : "Đăng ký tham gia"}
                </button>
              </section>
            )}
          {inside && section === "overview" && <OverviewView {...views} />}{" "}
          {inside && section === "statement" && <StatementView {...views} />}{" "}
          {inside && !guest && data.entered && section === "data" && <DataView {...views} />}{" "}
          {inside && !guest && !data.entered && section === "data" && <LockedResources title="Dữ liệu đang khóa" text="Đăng ký tham gia vòng luyện và chờ được duyệt để tải tài nguyên khi mở phát."/>}
          {inside && data.entered && section === "submit" && (
            <SubmitView key={c.id} {...views} />
          )}{" "}
          {inside && section === "leaderboard" && <BoardView {...views} />}
          {section === "team" && !guest && !isAdmin && <TeamView {...props} />}{" "}
          {section === "settings" && !guest && <ProfileView {...props} onRefresh={()=>load()} />}{" "}
          {!guest && (section === "workspace" || workspaceMounted) && (
            <div hidden={section !== "workspace"}>
              <GpuWorkspace
                key={`${data.user?.id}:${data.user?.admin}:${data.user?.teamId ?? ""}`}
                {...props}
                active={section === "workspace"}
              />
            </div>
          )}
          {section === "people" && isAdmin && <AdminRoster />}
          {inside && isAdmin && section === "admin" && (
            <RoundAdmin {...props} />
          )}
        </main>
        <footer className="arena-footer"><p>OlpAI Arena — không gian luyện tập AI, làm bài theo đội và theo dõi kết quả trên bảng xếp hạng.</p><LegalLinks/></footer>
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
