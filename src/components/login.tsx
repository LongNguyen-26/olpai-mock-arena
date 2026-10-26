"use client";
import { useState } from "react";
import { ArrowRight, ChevronRight, Clock3, Users, Layers3 } from "lucide-react";
export default function Login() {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/auth/${register ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(f)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể kết nối.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <a className="brand" href="/login">
          <span className="brand-symbol">
            A<span>·</span>
          </span>
          <span>
            olpai<span className="brand-light">arena</span>
          </span>
        </a>
        <div className="auth-pitch">
          <span className="eyebrow orange">
            OLYMPIC AI · PRACTICE SEASON 2026
          </span>
          <h1>
            Sáu giờ tập trung.
            <span className="auth-title-break"> Một bước tiến xa.</span>
          </h1>
          <p>
            Luyện như thi thật. Từ baseline đầu tiên đến bản nộp cuối, cùng đội
            của bạn làm chủ cuộc đua.
          </p>
          <div className="orbit-art" aria-hidden="true">
            <i />
            <i />
            <i />
            <b>AI</b>
            <span className="orbit-label">BUILD. VALIDATE. SUBMIT.</span>
          </div>
          <div className="auth-facts">
            <span>
              <Clock3 size={17} />
              5h public + 1h private
            </span>
            <span>
              <Layers3 size={17} />2 tác vụ độc lập
            </span>
            <span>
              <Users size={17} />
              Đội tối đa 3 người
            </span>
          </div>
        </div>
        <small>
          Bộ luyện độc lập · Không phải website chính thức của BTC OlpAI
        </small>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form">
          <span className="eyebrow muted">CHÀO MỪNG ĐẾN ĐẤU TRƯỜNG</span>
          <h2>{register ? "Bắt đầu hành trình" : "Sẵn sàng vào thi?"}</h2>
          <p>
            {register
              ? "Tạo tài khoản cá nhân, sau đó kết nối với đồng đội."
              : "Đăng nhập để vào không gian luyện tập của bạn."}
          </p>
          <div className="segmented">
            <button
              className={!register ? "active" : ""}
              onClick={() => {
                setRegister(false);
                setError("");
              }}
            >
              Đăng nhập
            </button>
            <button
              className={register ? "active" : ""}
              onClick={() => {
                setRegister(true);
                setError("");
              }}
            >
              Tạo tài khoản
            </button>
          </div>
          <form onSubmit={send}>
            {register && (
              <label>
                Họ và tên
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={60}
                  placeholder="Nguyễn Minh Anh"
                  autoComplete="name"
                />
              </label>
            )}
            <label>
              Tên đăng nhập
              <input
                name="username"
                required
                minLength={3}
                maxLength={24}
                pattern="[a-zA-Z0-9_]+"
                placeholder="Tên tài khoản của bạn"
                autoComplete="username"
              />
            </label>
            <label>
              Mật khẩu
              <input
                name="password"
                type="password"
                required
                minLength={register ? 10 : 1}
                maxLength={128}
                placeholder={register ? "Tối thiểu 10 ký tự" : "Nhập mật khẩu"}
                autoComplete={register ? "new-password" : "current-password"}
              />
            </label>
            {register && (
              <small>
                Tên đăng nhập gồm 3–24 chữ cái, số hoặc dấu _. Không cần xác
                thực email.
              </small>
            )}
            {error && (
              <div role="alert" className="alert error">
                {error}
              </div>
            )}
            <button disabled={busy} className="btn primary wide" type="submit">
              {busy
                ? "Đang kết nối…"
                : register
                  ? "Tạo tài khoản"
                  : "Vào đấu trường"}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="auth-tip">
            <span className="status-dot" />
            Một nơi để thử nghiệm, mắc lỗi và tiến bộ.
            <ChevronRight size={15} />
          </div>
        </div>
      </section>
    </main>
  );
}
