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
          <span className="eyebrow orange">OLYMPIC AI 2026</span>
          <h1>
            Ôn luyện mô phỏng
            <span className="auth-title-break"> Olympic AI 2026.</span>
          </h1>
          <p>
            Thực hành trong môi trường thi, đăng ký vòng luyện và theo dõi kết
            quả cùng đội của bạn.
          </p>
          <div className="orbit-art" aria-hidden="true">
            <i />
            <i />
            <i />
            <b>AI</b>
          </div>
          <div className="auth-facts">
            <span>
              <Clock3 size={17} />
              Vòng luyện có hẹn giờ
            </span>
            <span>
              <Layers3 size={17} />
              Đề thi theo từng bộ
            </span>
            <span>
              <Users size={17} />
              Cộng tác theo đội
            </span>
          </div>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form">
          <span className="eyebrow muted">OLYMPIC AI 2026</span>
          <h2>{register ? "Đăng ký" : "Đăng nhập"}</h2>
          <p>
            {register
              ? "Đăng ký cá nhân, sau đó kết nối với đồng đội."
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
              Đăng ký
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
              {busy ? "Đang kết nối…" : register ? "Đăng ký" : "Đăng nhập"}
              <ArrowRight size={18} />
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
