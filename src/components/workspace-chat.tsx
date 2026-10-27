"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Plus, Send, Sparkles } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./arena-client";
import type { readChat } from "@/lib/workspaces";
import { chatSession } from "@/lib/chat-session";
import { assistantText } from "@/lib/chat-presentation";
type Chat = Awaited<ReturnType<typeof readChat>>;
export default function WorkspaceChat() {
  const [id, setId] = useState(""),
    [session, setSession] = useState(""),
    [data, setData] = useState<Chat | null>(null),
    [content, setContent] = useState(""),
    [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [busy, setBusy] = useState(false),
    [pendingText, setPendingText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const sequence = useRef(0),
    sending = useRef(false);
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("id") ?? "";
    setId(id);
    if (id) setSession(chatSession(sessionStorage, id));
  }, []);
  const load = useCallback(async () => {
    if (!id || !session || sending.current) return;
    const version = ++sequence.current;
    try {
      const next = await api(
        `workspace/chat?id=${encodeURIComponent(id)}&session=${encodeURIComponent(session)}`,
      );
      if (version === sequence.current) setData(next);
    } catch (e) {
      if (version === sequence.current) setError((e as Error).message);
    }
  }, [id, session]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      clearInterval(timer);
      sequence.current++;
    };
  }, [load]);
  useEffect(() => {
    bottom.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "end",
    });
  }, [data?.session.messages.length, pendingText, busy, error, info]);
  function newSession() {
    if (sending.current) return;
    sequence.current++;
    const next = chatSession(sessionStorage, id, true);
    setSession(next);
    setData(null);
    setContent("");
    setPendingText("");
    setError("");
    setInfo("Đã tạo đoạn chat mới.");
  }
  const used =
      (data?.session.inputTokens ?? 0) + (data?.session.outputTokens ?? 0),
    limit = data?.template.sessionTokenLimit ?? 2000;
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text || sending.current || !data) return;
    setError("");
    setInfo("");
    if (text.startsWith("/")) {
      setContent("");
      if (text === "/new") {
        newSession();
        return;
      }
      if (["/usage", "/limits", "/help"].includes(text)) {
        setInfo(
          text === "/help"
            ? "/usage — token đã dùng; /limits — các giới hạn; /new — phiên mới. Toàn bộ lịch sử đầu vào và token suy luận/đầu ra được tính."
            : `Phiên này: ${used}/${limit} token. Input đã dùng ${data?.session.inputTokens ?? 0}; output đã dùng ${data?.session.outputTokens ?? 0}. Mỗi lượt: input ≤ ${data?.template.inputTokenLimit ?? 1800}, output ≤ ${data?.template.outputTokenLimit ?? 1024}; tổng vẫn ≤ ${limit}.`,
        );
        return;
      }
      setInfo("Lệnh chưa hỗ trợ. Dùng /help.");
      return;
    }
    if (!data.enabled) return;
    setBusy(true);
    setPendingText(text);
    setContent("");
    sending.current = true;
    sequence.current++;
    try {
      const result = await api("workspace/chat", {
        id,
        session,
        requestId: crypto.randomUUID(),
        content: text,
      });
      setData((d) => (d ? { ...d, session: result.session } : d));
    } catch (e) {
      setError((e as Error).message);
      setContent((draft) => draft || text);
    } finally {
      sending.current = false;
      setPendingText("");
      setBusy(false);
      await load();
    }
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
          <span
            className={`chat-connection ${data?.enabled ? "is-ready" : ""}`}
            role="status"
          >
            <i aria-hidden="true" />
            {!data
              ? "Đang kết nối…"
              : data.enabled
                ? "DeepSeek sẵn sàng"
                : data.policyOpen
                  ? "DeepSeek đang khởi động"
                  : "Chatbot đang khóa"}
          </span>
          <button className="btn" onClick={newSession} disabled={busy || !data}>
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
                Hỏi ngắn, cung cấp lỗi hoặc giả thuyết cần kiểm tra. Chatbot và
                notebook dùng chung GPU; training có thể làm phản hồi chậm hơn.
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
                <Markdown remarkPlugins={[remarkGfm]}>
                  {message.role === "assistant"
                    ? assistantText(message.content) ||
                      "Chưa có nội dung trả lời. Hãy yêu cầu phản hồi ngắn hơn."
                    : message.content}
                </Markdown>
              </div>
            </article>
          ))}
          {pendingText && (
            <article className="chat-message user">
              <strong>Đội của bạn</strong>
              <div className="prose">
                <Markdown remarkPlugins={[remarkGfm]}>{pendingText}</Markdown>
              </div>
            </article>
          )}
          {busy && (
            <div className="chat-thinking" role="status">
              <span className="chat-thinking-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              DeepSeek đang suy luận…
            </div>
          )}
          {data && !data.enabled && (
            <p className="gpu-hint">
              {data.policyOpen
                ? data.statusMessage ||
                  "Đang chờ model sẵn sàng. Trang sẽ tự cập nhật."
                : "Chatbot chỉ mở trong public của vòng luyện. Các lệnh kiểm tra token vẫn xem được."}
            </p>
          )}
          {data?.session.pending && (
            <p role="alert">
              Lượt trước bị gián đoạn; ngân sách tối đa đã được giữ. Dùng /new
              để tiếp tục với phiên mới.
            </p>
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
              busy ||
              !data ||
              !content.trim() ||
              (!data.enabled && !content.trim().startsWith("/"))
            }
            aria-label="Gửi tin nhắn"
          >
            <Send size={19} />
          </button>
        </form>
        <small className="chat-footer">
          Enter để gửi · Shift + Enter để xuống dòng · /limits để xem giới hạn
        </small>
      </section>
    </main>
  );
}
