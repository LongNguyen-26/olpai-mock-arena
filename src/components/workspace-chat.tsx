"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Plus, Send, Sparkles } from "lucide-react";
import ChatMarkdown from "./chat-markdown";
import { api, ApiClientError } from "./arena-client";
import type { readChat } from "@/lib/workspaces";
import { chatSession } from "@/lib/chat-session";
import { assistantText } from "@/lib/chat-presentation";
import {
  chatLimitSummary,
  chatUsageLog,
  isChatClosed,
} from "@/lib/chat-limits";
type Outbox = { requestId: string; content: string; runId: string };
type Chat = Awaited<ReturnType<typeof readChat>>;
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
  const outboxRef = useRef<Outbox | null>(null);
  const target = groupId ? `group:${groupId}` : id;
  const active = busy || !!outbox || !!data?.session.pending;
  const pendingText = outbox?.content ?? "";
  const bottom = useRef<HTMLDivElement>(null);
  const sequence = useRef(0),
    sending = useRef(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("id") ?? "",
      group = url.searchParams.get("groupId") ?? "";
    setId(id);
    setGroupId(group);
    const target = group ? `group:${group}` : id;
    if (target) {
      const session = chatSession(sessionStorage, target);
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
        setBusy(false);
      }
    },
    [id, groupId, session, clearOutbox],
  );
  const load = useCallback(async () => {
    if (!target || !session || sending.current) return;
    const version = ++sequence.current;
    try {
      const next: Chat = await api(
        `workspace/chat?${groupId ? `groupId=${encodeURIComponent(groupId)}` : `id=${encodeURIComponent(id)}`}&session=${encodeURIComponent(session)}`,
      );
      if (version !== sequence.current) return;
      setData(next);
      const saved = outboxRef.current;
      if (saved) {
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
    }
  }, [id, groupId, target, session, clearOutbox, transmit]);
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
    setData(null);
    setContent("");
    clearOutbox();
    setError("");
    setInfo("Đã tạo đoạn chat mới.");
    setShowUsage(false);
  }
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
    if (!data.enabled || closed) return;
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
    <main className="chat-shell">
      <header className="chat-header">
        <div>
          <span className="chat-brand">
            <Cpu size={23} />
            DeepSeek R1 · 32B Q4
          </span>
          <p>
            {data ? `${data.teamName} · ${data.roundTitle}` : "GPU Workspace"}
          </p>
        </div>
        <div className="chat-header-actions">
          <button
            className="btn"
            onClick={newSession}
            disabled={active || !data}
          >
            <Plus size={17} />
            Đoạn chat mới
          </button>
        </div>
      </header>
      <section className="chat-main">
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
                {message.role === "user" ? "Đội của bạn" : "DeepSeek"}
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
          {data && !data.enabled && !active && (
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
            aria-label="Tin nhắn cho DeepSeek"
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
          </button>
        </form>
        <small className="chat-footer">
          {data
            ? chatLimitSummary(data.template, data.session)
            : "Đang tải giới hạn token…"}{" "}
          · Enter để gửi · Shift + Enter để xuống dòng · /limits để xem giới hạn
        </small>
      </section>
    </main>
  );
}
