"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Plus, Send, Sparkles, History, X } from "lucide-react";
import ChatMarkdown from "./chat-markdown";
import { api, ApiClientError } from "./arena-client";
import type { readChat } from "@/lib/workspaces";
import { chatSession } from "@/lib/chat-session";
import { assistantText } from "@/lib/chat-presentation";
import { draftCharacterCount } from "@/lib/chat-conversation";
import type { chatHistory } from "@/lib/chat-history";
import {
  chatUsageLog,
  isChatClosed,
} from "@/lib/chat-limits";
type Outbox = { requestId: string; content: string; runId: string };
type Chat = Awaited<ReturnType<typeof readChat>> | Awaited<ReturnType<typeof import("@/lib/chat-history").readConversation>>;
type HistoryPage = Awaited<ReturnType<typeof chatHistory>>;
export default function WorkspaceChat() {
  const [id, setId] = useState(""),
    [groupId, setGroupId] = useState(""),
    [session, setSession] = useState(""),
    [data, setData] = useState<Chat | null>(null),
    [content, setContent] = useState(""),
    [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [showUsage, setShowUsage] = useState(false),
    [busy, setBusy] = useState(false),
    [outbox, setOutbox] = useState<Outbox | null>(null);
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [selectedRef, setSelectedRef] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  useEffect(()=>{const mq=window.matchMedia("(max-width:760px)");const update=()=>setMobile(mq.matches);update();mq.addEventListener("change",update);return()=>mq.removeEventListener("change",update);},[]);
  useEffect(()=>{if(!sidebarOpen)return;const escape=(e:KeyboardEvent)=>{if(e.key==="Escape")setSidebarOpen(false);};window.addEventListener("keydown",escape);return()=>window.removeEventListener("keydown",escape);},[sidebarOpen]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historySequence = useRef(0);
  const outboxRef = useRef<Outbox | null>(null);
  const target = groupId ? `group:${groupId}` : id;
  const active = busy || !!outbox || !!data?.session.pending;
  const pendingText = outbox?.content ?? "";
  const bottom = useRef<HTMLDivElement>(null);
  const sequence = useRef(0),
    sending = useRef(false);
  const sendingSession = useRef("");
  const loading = useRef<{key:string} | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("id") ?? "",
      group = url.searchParams.get("groupId") ?? "";
    setId(id);
    setGroupId(group);
    const target = group ? `group:${group}` : id;
    if (target) {
      let session = chatSession(sessionStorage, target);
      try {
        const selected = JSON.parse(sessionStorage.getItem(`arena-chat-selected:${target}`) ?? "null");
        if (typeof selected?.ref === "string" && typeof selected?.sessionId === "string") { setSelectedRef(selected.ref); session = selected.sessionId; }
      } catch { /* Ignore an invalid local selection. */ }
      setSession(session);
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(`arena-chat-outbox:${target}:${session}`) ??
            "null",
        );
        if (saved?.requestId && saved?.content && saved?.runId) {
          outboxRef.current = saved;
          setOutbox(saved);
        }
      } catch {
        /* An invalid browser draft is never sent to the server. */
      }
    }
  }, []);
  const clearOutbox = useCallback(() => {
    outboxRef.current = null;
    setOutbox(null);
    sessionStorage.removeItem(`arena-chat-outbox:${target}:${session}`);
  }, [target, session]);
  const transmit = useCallback(
    async (message: Outbox) => {
      if (sending.current) return;
      sending.current = true;
      sendingSession.current = session;
      setBusy(true);
      const version = ++sequence.current;
      try {
        const result = await api("workspace/chat", {
          ...(groupId ? { groupId } : { id }),
          session,
          ...message,
        });
        if (version !== sequence.current) return;
        setData((d) =>
          d
            ? {
                ...d,
                session: result.session,
                template: result.template ?? d.template,
              }
            : d,
        );
        clearOutbox();
        setError("");
      } catch (e) {
        if (
          version === sequence.current &&
          e instanceof ApiClientError &&
          e.status < 500
        ) {
          clearOutbox();
          setError(e.message);
          setContent((draft) => draft || message.content);
        }
        // A lost ACK is retried with the same ID; it never creates a second prompt.
      } finally {
        sending.current = false;
        sendingSession.current = "";
        setBusy(false);
      }
    },
    [id, groupId, session, clearOutbox],
  );
  const load = useCallback(async () => {
    if (!target || !session || (sending.current && sendingSession.current===session)) return;
    const key=`${target}:${session}:${selectedRef}`;
    if(loading.current?.key===key)return;
    const ticket={key};loading.current=ticket;
    const version = ++sequence.current;
    try {
      const next: Chat = await api(
        selectedRef
          ? `workspace/chat/history?${groupId ? `groupId=${encodeURIComponent(groupId)}` : `id=${encodeURIComponent(id)}`}&conversation=${encodeURIComponent(selectedRef)}`
          : `workspace/chat?${groupId ? `groupId=${encodeURIComponent(groupId)}` : `id=${encodeURIComponent(id)}`}&session=${encodeURIComponent(session)}`,
      );
      if (version !== sequence.current) return;
      setData(next);
      const saved = outboxRef.current;
      if (saved && next.readOnly) {
        clearOutbox();
        setInfo("Cuộc trò chuyện đã chuyển sang chỉ đọc. Tin nhắn chưa xác nhận sẽ không được tự gửi lại.");
      } else if (saved) {
        if (
          saved.runId !== next.runId ||
          next.session.pending?.requestId === saved.requestId ||
          next.session.lastRequestId === saved.requestId
        )
          clearOutbox();
        else await transmit(saved);
      }
    } catch (e) {
      if (
        version === sequence.current &&
        e instanceof ApiClientError &&
        e.status < 500
      )
        setError(e.message);
    } finally {
      if(loading.current===ticket)loading.current=null;
    }
  }, [id, groupId, target, session, selectedRef, clearOutbox, transmit]);
  const loadHistory = useCallback(async (cursor?: string) => {
    if (!target) return;
    const version = ++historySequence.current;
    if (cursor) setHistoryBusy(true);
    try {
      const next: HistoryPage = await api(`workspace/chat/history?${groupId ? `groupId=${encodeURIComponent(groupId)}` : `id=${encodeURIComponent(id)}`}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (version !== historySequence.current) return;
      setHistory(previous => {
        const existing = cursor ? previous?.items ?? [] : (previous?.items.length ?? 0) > 50 ? previous!.items : [];
        const items = [...new Map([...existing, ...next.items].map(item => [item.id,item])).values()].sort((a,b)=>b.updatedAt-a.updatedAt||b.id.localeCompare(a.id));
        return {...next,items,nextCursor: !cursor && (previous?.items.length ?? 0)>50 ? previous!.nextCursor : next.nextCursor};
      });
      setHistoryError("");
    } catch { if(version===historySequence.current)setHistoryError("Chưa tải được lịch sử. Hãy thử lại."); }
    finally { if(version===historySequence.current)setHistoryBusy(false); }
  }, [id, groupId, target]);
  useEffect(() => {
    void loadHistory();
    const timer=setInterval(()=>void loadHistory(),10000);
    return ()=>{clearInterval(timer);historySequence.current++;};
  }, [loadHistory, data?.session.messages.length]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), active ? 2000 : 10000);
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [load, active]);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [session],
  );
  useEffect(() => {
    bottom.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "end",
    });
  }, [data?.session.messages.length, pendingText, busy, error, info]);
  function newSession() {
    if (active) return;
    sequence.current++;
    const next = chatSession(sessionStorage, target, true);
    setSession(next);
    setSelectedRef("");
    sessionStorage.removeItem(`arena-chat-selected:${target}`);
    setSidebarOpen(false);
    setData(null);
    setContent("");
    clearOutbox();
    setError("");
    setInfo("Đã tạo đoạn chat mới.");
    setShowUsage(false);
  }
  function selectConversation(item: HistoryPage["items"][number]) {
    if(selectedRef===item.id||(!selectedRef&&item.current&&item.sessionId===session)) { setSidebarOpen(false);return; }
    sequence.current++;
    outboxRef.current=null;setOutbox(null);
    setSession(item.sessionId);setSelectedRef(item.id);setData(null);setContent("");setError("");setInfo("");setShowUsage(false);setSidebarOpen(false);
    sessionStorage.setItem(`arena-chat-selected:${target}`,JSON.stringify({ref:item.id,sessionId:item.sessionId}));
    try {
      const saved=JSON.parse(sessionStorage.getItem(`arena-chat-outbox:${target}:${item.sessionId}`)??"null");
      if(item.current&&saved?.requestId&&saved?.content&&saved?.runId){outboxRef.current=saved;setOutbox(saved);}
    } catch { /* No valid outbox for the selected conversation. */ }
  }
  const remaining=data?Math.max(0,data.template.sessionTokenLimit-data.session.inputTokens-data.session.outputTokens):null;
  const characterCount=draftCharacterCount(content);
  const closed = !!data && isChatClosed(data.template, data.session);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text || active || !data) return;
    setError("");
    setInfo("");
    setShowUsage(false);
    if (text.startsWith("/")) {
      setContent("");
      if (text === "/new") {
        newSession();
        return;
      }
      if (["/usage", "/limits", "/help"].includes(text)) {
        if (text === "/help")
          setInfo(
            "/usage — token đã dùng; /limits — các giới hạn; /new — phiên mới. Token suy luận được tính vào output.",
          );
        else setShowUsage(true);
        return;
      }
      setInfo("Lệnh chưa hỗ trợ. Dùng /help.");
      return;
    }
    if (!data.enabled || closed || data.readOnly) return;
    const message = {
      requestId: crypto.randomUUID(),
      content: text,
      runId: data.runId,
    };
    sessionStorage.setItem(
      `arena-chat-outbox:${target}:${session}`,
      JSON.stringify(message),
    );
    outboxRef.current = message;
    setOutbox(message);
    setContent("");
    await transmit(message);
  }

  return (
    <main className={`chat-shell has-history ${sidebarOpen ? "is-history-open" : ""}`}>
      {sidebarOpen && <button className="chat-history-backdrop" aria-label="Đóng lịch sử" onClick={()=>setSidebarOpen(false)} />}
      <aside className="chat-sidebar" aria-label="Lịch sử trò chuyện" inert={mobile&&!sidebarOpen} aria-hidden={mobile&&!sidebarOpen?true:undefined}>
        <div className="chat-sidebar-heading"><strong><History size={18}/> Lịch sử trò chuyện</strong><button className="chat-sidebar-close" aria-label="Đóng lịch sử" onClick={()=>setSidebarOpen(false)}><X size={18}/></button></div>
        <p>{history?.roundTitle ?? "Theo đội và vòng luyện"}</p>
        <button className="btn chat-new" onClick={newSession} disabled={active || (!data && !history)}><Plus size={17}/>Đoạn chat mới</button>
        <nav className="chat-history-list" aria-label="Các cuộc trò chuyện">
          {history?.items.map(item=><button key={item.id} className={`chat-history-item ${selectedRef===item.id||(!selectedRef&&item.current&&item.sessionId===session)?"is-selected":""}`} onClick={()=>selectConversation(item)} aria-current={selectedRef===item.id?"page":undefined} title={item.title}>
            <strong>{item.title}</strong><small>{new Date(item.updatedAt).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}{!item.current?" · Đã lưu":""}</small>
          </button>)}
          {history && !history.items.length && <p>Cuộc trò chuyện sẽ xuất hiện ở đây sau tin nhắn đầu tiên.</p>}
          {historyError && <p role="status">{historyError}<button className="btn small-btn" onClick={()=>void loadHistory()}>Thử lại</button></p>}
          {history?.nextCursor && <button className="btn small-btn" disabled={historyBusy} onClick={()=>void loadHistory(history.nextCursor!)}>Xem thêm</button>}
        </nav>
        <small className="chat-history-note">Lịch sử của đội được giữ lại sau khi vòng luyện kết thúc.</small>
      </aside>
      <div className="chat-content">
      <header className="chat-header">
        <button className="btn chat-history-toggle" aria-label="Mở lịch sử trò chuyện" aria-expanded={sidebarOpen} onClick={()=>setSidebarOpen(true)}><History size={19}/></button>
        <div>
          <span className="chat-brand">
            <Cpu size={23} />
            {data?.admin ? data.model : "Trợ lý AI"}
          </span>
          <p>
            {data ? `${data.teamName} · ${data.roundTitle}` : "GPU Workspace"}
          </p>
        </div>
        <div className="chat-header-actions">
          <div className="chat-token-badge" role="status" aria-label="Token còn lại"><strong>{remaining===null?"—":remaining.toLocaleString("vi-VN")}</strong><span>token còn lại</span></div>
        </div>
      </header>
      <section className="chat-main">
        {data?.admin && data.provider === "groq" && <p className="gpu-hint">Groq · Token được chốt theo thống kê của model. Trước mỗi lượt, hệ thống giữ ngân sách dự phòng bảo thủ để tránh vượt giới hạn.</p>}
        <div
          className="chat-messages"
          role="log"
          aria-label="Cuộc trò chuyện"
          aria-live="polite"
        >
          {!data?.session.messages.length && !pendingText && (
            <div className="chat-welcome">
              <span className="chat-welcome-icon">
                <Sparkles size={30} />
              </span>
              <h1>Trợ lý cho đội thi của bạn</h1>
              <p>
                Hỏi ngắn, cung cấp lỗi hoặc giả thuyết cần kiểm tra. Lịch sử và
                ngân sách token được lưu riêng cho phiên chat này.
              </p>
              <p>
                <code>/usage</code> · <code>/limits</code> · <code>/new</code> ·{" "}
                <code>/help</code>
              </p>
            </div>
          )}
          {data?.session.messages.map((message, i) => (
            <article className={`chat-message ${message.role}`} key={i}>
              <strong>
                {message.role === "user" ? "Đội của bạn" : data?.admin ? data.model : "Trợ lý AI"}
              </strong>
              <div className="prose">
                <ChatMarkdown>
                  {message.role === "assistant"
                    ? assistantText(message.content) ||
                      "Chưa có nội dung trả lời. Hãy yêu cầu phản hồi ngắn hơn."
                    : message.content}
                </ChatMarkdown>
              </div>
            </article>
          ))}
          {pendingText && (
            <article className="chat-message user">
              <strong>Đội của bạn</strong>
              <div className="prose">
                <ChatMarkdown>{pendingText}</ChatMarkdown>
              </div>
            </article>
          )}
          {data?.readOnly && <p className="chat-archive-notice">Cuộc trò chuyện đã lưu · Chỉ đọc. Chọn Đoạn chat mới để bắt đầu khi vòng luyện mở.</p>}
          {data && !data.readOnly && !data.enabled && !active && (
            <p className="gpu-hint">
              {data.policyOpen
                ? data.statusMessage || "Chatbot tạm thời chưa khả dụng."
                : "Quyền chatbot đang khóa hoặc đã hết hạn theo cấu hình của quản trị viên. Các lệnh kiểm tra token vẫn xem được."}
            </p>
          )}
          {data?.session.error && (
            <div className="alert error" role="alert">
              {data.session.error}
            </div>
          )}
          {data && !data.session.pending && closed && (
            <div className="alert" role="status">
              {data.session.exhausted?.message ??
                "Phiên đã hết ngân sách token. Dùng /new hoặc Đoạn chat mới để tiếp tục."}
            </div>
          )}
          {data?.session.limitNotice && (
            <div className="alert" role="status">
              {data.session.limitNotice}
            </div>
          )}
          {showUsage && data && (
            <div className="alert" role="status">
              {chatUsageLog(data.template, data.session)}
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
              {/đăng nhập/i.test(error) && <a href="/login"> Đăng nhập</a>}
            </div>
          )}
          {info && (
            <div className="alert" role="status">
              {info}
            </div>
          )}
          <div ref={bottom} />
        </div>
        <form className="chat-compose" onSubmit={send}>
          <textarea
            aria-label="Tin nhắn cho Chatbot"
            placeholder="Nhập câu hỏi hoặc /help…"
            value={content}
            maxLength={16000}
            rows={3}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="chat-compose-actions"><span className="chat-character-count" aria-label="Số ký tự">{characterCount.toLocaleString("vi-VN")} ký tự</span>
          <button
            className="btn primary"
            disabled={
              active ||
              !data ||
              !content.trim() ||
              ((!data.enabled || closed) && !content.trim().startsWith("/"))
            }
            aria-label="Gửi tin nhắn"
          >
            <Send size={19} />
          </button></div>
        </form>
        <small className="chat-footer">
          Enter để gửi · Shift + Enter để xuống dòng · /limits để xem giới hạn
        </small>
      </section>
      </div>
    </main>
  );
}
