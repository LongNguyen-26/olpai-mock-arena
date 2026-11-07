"use client";
import LegalLinks from "./legal-links";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Clock3, Users, Layers3, MailCheck } from "lucide-react";
type Mode = "login" | "register" | "forgot" | "reset" | "confirmation";
export default function Login({ options, next, initialMode, initialError }: {
  options: {supabase:boolean;google:boolean}; next:string; initialMode:string; initialError:string;
}) {
  const [mode,setMode] = useState<Mode>(["register","forgot","reset"].includes(initialMode) ? initialMode as Mode : "login");
  const [busy,setBusy] = useState(false), [error,setError] = useState(initialError), [notice,setNotice] = useState(""), [email,setEmail] = useState("");
  const [resendReadyAt,setResendReadyAt] = useState(0), [clock,setClock] = useState(Date.now);
  const resendCooldown = Math.max(0,Math.ceil((resendReadyAt-clock)/1000));
  function startResendCooldown() { const now=Date.now();setClock(now);setResendReadyAt(now+60000); }
  useEffect(()=>{
    if (mode !== "confirmation" || resendReadyAt <= Date.now()) return;
    const timer = setInterval(()=>{const now=Date.now();setClock(now);if(now>=resendReadyAt)clearInterval(timer);},1000);
    return ()=>clearInterval(timer);
  },[resendReadyAt,mode]);
  function change(mode: Mode) { setMode(mode); setError(""); setNotice(""); }
  async function request(route:string,value:unknown) {
    const res = await fetch(`/api/auth/${route}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Không thể thực hiện yêu cầu.");
    return data;
  }
  async function send(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const data = await request(mode,{...values,next});
      if (mode === "register" && data.confirmationRequired) { setEmail(String(values.username)); setMode("confirmation"); startResendCooldown(); }
      else if (mode === "forgot") setNotice("Nếu email có tài khoản xác thực, bạn sẽ nhận được liên kết đặt lại mật khẩu. Hãy kiểm tra cả thư rác và mở liên kết trên trình duyệt này.");
      else if (mode === "reset") { setMode("login"); setNotice("Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới."); }
      else window.location.assign(data.needsName ? `/onboarding?next=${encodeURIComponent(next)}` : next);
    } catch(e) { setError(e instanceof Error ? e.message : "Không thể kết nối."); }
    finally { setBusy(false); }
  }
  async function google() {
    setBusy(true);setError("");
    try { const result = await request("google",{next}); window.location.assign(result.url); }
    catch(e) { setError(e instanceof Error ? e.message : "Không thể mở Google."); setBusy(false); }
  }
  async function resend() {
    if (busy || resendCooldown || !window.confirm(`Gửi lại email xác nhận đến ${email}? Hãy kiểm tra hộp thư và thư rác trước khi gửi lại.`)) return;
    setBusy(true);setError("");
    try { await request("resend",{username:email,next}); startResendCooldown(); setNotice("Đã yêu cầu gửi lại email. Hãy dùng liên kết mới nhất trên trình duyệt này."); }
    catch(e) { setError(e instanceof Error ? e.message : "Không thể gửi email."); }
    finally { setBusy(false); }
  }
  const register = mode === "register";
  const titles = {login:"Chào mừng trở lại",register:"Tạo tài khoản của bạn",forgot:"Quên mật khẩu",reset:"Đặt mật khẩu mới",confirmation:"Kiểm tra hộp thư của bạn"};
  return <main className="auth-page">
    <section className="auth-story">
      <a className="brand" href="/"><span className="brand-symbol">A<span>·</span></span><span>OlpAI<span className="brand-light"> Arena</span></span></a>
      <div className="auth-pitch">
        <span className="eyebrow orange">OLYMPIC AI 2026</span>
        <h1>Ôn luyện mô phỏng<span className="auth-title-break"> Olympic AI 2026.</span></h1>
        <p>Khám phá đề thi, luyện tập cùng đồng đội và theo dõi hành trình của bạn trên bảng xếp hạng.</p>
        <div className="orbit-art" aria-hidden="true"><i/><i/><i/><b>AI</b></div>
        <div className="auth-facts"><span><Clock3 size={17}/>Vòng luyện có hẹn giờ</span><span><Layers3 size={17}/>Đề thi theo từng bộ</span><span><Users size={17}/>Cộng tác theo đội</span></div>
      </div>
    </section>
    <section className="auth-form-panel"><div className="auth-form">
      <a className="auth-back" href={next}><ArrowLeft size={16}/>Tiếp tục khám phá Arena</a>
      <span className="eyebrow muted">KHÔNG GIAN LUYỆN TẬP CỦA BẠN</span>
      <h2>{titles[mode]}</h2>
      <p>{register ? "Đăng ký cá nhân, sau đó kết nối với đồng đội." : mode === "login" ? "Đăng nhập để tải dữ liệu, nộp bài và sử dụng không gian của đội." : mode === "confirmation" ? `Chúng tôi đã yêu cầu gửi liên kết xác nhận đến ${email}.` : "Bảo vệ tài khoản và tiếp tục hành trình luyện tập."}</p>
      {["login","register"].includes(mode) && <>
        <div className="segmented"><button type="button" disabled={busy} className={!register ? "active" : ""} onClick={()=>change("login")}>Đăng nhập</button><button type="button" disabled={busy} className={register ? "active" : ""} onClick={()=>change("register")}>Đăng ký</button></div>
        {options.google && <><button className="btn wide google-auth" disabled={busy} onClick={google}><span aria-hidden="true" className="google-mark">G</span>Tiếp tục với Google</button><div className="auth-divider"><span>hoặc dùng email</span></div></>}
      </>}
      {error && <div role="alert" className="alert error">{error}</div>}
      {notice && <div role="status" className="alert auth-notice">{notice}</div>}
      {mode === "confirmation" ? <div className="confirmation-content">
        <MailCheck size={38}/><p>Mở liên kết trong email trên chính trình duyệt này để xác nhận và tiếp tục. Kiểm tra thư rác nếu chưa thấy email.</p>
        <div className="confirmation-resend"><span>Chưa thấy thư sau khi kiểm tra thư rác?</span><button type="button" className="text-button resend-confirmation" disabled={busy || resendCooldown>0} onClick={resend}>{busy ? "Đang gửi…" : resendCooldown>0 ? `Gửi lại sau ${resendCooldown}s` : "Gửi lại email xác nhận"}</button></div>
        <button className="text-button" disabled={busy} onClick={()=>change("login")}>Quay lại đăng nhập</button>
      </div> : <form onSubmit={send}>
        {register && <label>Họ và tên<input name="name" required minLength={2} maxLength={60} placeholder="Nguyễn Minh Anh" autoComplete="name"/></label>}
        {mode !== "reset" && <label>{mode === "login" ? "Email hoặc tên đăng nhập" : "Email"}<input name="username" required type={mode === "login" ? "text" : "email"} maxLength={254} placeholder={mode === "login" ? "Email hoặc tên tài khoản" : "ban@example.com"} autoComplete="username" autoCapitalize="none" spellCheck={false}/></label>}
        {mode !== "forgot" && <label>{mode === "reset" ? "Mật khẩu mới" : "Mật khẩu"}<input name="password" type="password" required minLength={register || mode === "reset" ? 10 : 1} maxLength={128} placeholder={register || mode === "reset" ? "Tối thiểu 10 ký tự" : "Nhập mật khẩu"} autoComplete={register || mode === "reset" ? "new-password" : "current-password"}/></label>}
        {register && <small>{options.supabase ? "Bạn cần xác nhận email trước khi sử dụng tài khoản." : "Dùng email của bạn để đăng ký tài khoản."} Khi tạo tài khoản, bạn đồng ý với <a href="/terms">Điều khoản sử dụng</a> và đã đọc <a href="/privacy">Chính sách bảo mật</a>.</small>}
        {mode === "forgot" && <small>Tính năng này dành cho tài khoản đăng ký qua email xác thực. Tài khoản cũ chưa liên kết cần liên hệ quản trị viên để khôi phục.</small>}
        {mode === "login" && options.supabase && <button className="text-button auth-forgot" type="button" disabled={busy} onClick={()=>change("forgot")}>Quên mật khẩu?</button>}
        <button disabled={busy} className="btn primary wide" type="submit">{busy ? "Đang xử lý…" : register ? "Tạo tài khoản" : mode === "forgot" ? "Gửi liên kết đặt lại" : mode === "reset" ? "Lưu mật khẩu mới" : "Đăng nhập"}<ArrowRight size={18}/></button>
        {["forgot","reset"].includes(mode) && <button className="text-button" type="button" disabled={busy} onClick={()=>change("login")}>Quay lại đăng nhập</button>}
      </form>}
      <LegalLinks/>
    </div></section>
  </main>;
}
