"use client";
import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "./arena-client";

export default function AccountPassword({ email, enabled, disabled, onRefresh }: {
  email: string; enabled: boolean; disabled: boolean; onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false), [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [remaining,setRemaining]=useState(0);
  useEffect(()=>{if(!remaining)return;const timer=setTimeout(()=>setRemaining(n=>Math.max(0,n-1)),1000);return()=>clearTimeout(timer);},[remaining]);
  async function sendCode() {
    setBusy(true); setError("");
    try { await api("auth/password-otp", {}); setSent(true); setRemaining(60); setNotice("Đã gửi mã xác nhận đến email tài khoản. Kiểm tra cả thư rác."); }
    catch (e) { setError(e instanceof Error ? e.message : "Không thể gửi mã."); }
    finally { setBusy(false); }
  }
  return <div className="account-detail account-password">
    <h3><KeyRound size={24}/> Mật khẩu</h3>
    <div className="account-value-row">
      <div><p>{enabled ? "Đã thiết lập mật khẩu" : "Chưa thiết lập mật khẩu"}</p><small>{enabled ? "Đăng nhập bằng email và mật khẩu trên các thiết bị của bạn." : "Thêm mật khẩu để đăng nhập trên thiết bị khác; Google vẫn dùng được."}</small></div>
      <button className="text-button account-edit" type="button" disabled={disabled || busy} onClick={() => { setEditing(!editing); setError(""); setNotice(""); }} aria-expanded={editing}>{enabled ? "Đổi mật khẩu" : "Thiết lập mật khẩu"}</button>
    </div>
    {notice && <p className="alert auth-notice" role="status">{notice}</p>}
    {error && <p className="alert error" role="alert">{error}</p>}
    {editing && <form className="account-edit-form" onSubmit={async e => {
      e.preventDefault(); const form=e.currentTarget, value=Object.fromEntries(new FormData(form));
      if (value.password !== value.confirmation) { setError("Hai mật khẩu chưa khớp."); return; }
      setBusy(true); setError("");
      try { await api(enabled ? "password" : "auth/set-password",value); form.reset(); setEditing(false); setSent(false); setNotice("Đã lưu mật khẩu."); await onRefresh(); }
      catch(e) { setError(e instanceof Error ? e.message : "Không thể lưu mật khẩu."); }
      finally { setBusy(false); }
    }}>
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden/>
      {enabled ? <label className="account-form-wide">Mật khẩu hiện tại<input type="password" name="current" autoComplete="current-password" required maxLength={128}/></label> : <>
        <p className="account-reauth-note account-form-wide">Xác nhận quyền truy cập email trước khi thêm mật khẩu.</p>
        <button type="button" className="btn small-btn account-code-button" onClick={sendCode} disabled={busy || remaining>0}>{remaining>0 ? `Gửi lại sau ${remaining}s` : sent ? "Gửi lại mã xác nhận" : "Gửi mã xác nhận"}</button>
        <label className="account-form-wide">Mã xác nhận qua email<input name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required/></label>
      </>}
      <label>Mật khẩu mới<input type="password" name="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="Tối thiểu 10 ký tự"/></label>
      <label>Nhập lại mật khẩu mới<input type="password" name="confirmation" required minLength={10} maxLength={128} autoComplete="new-password"/></label>
      <div className="account-form-actions"><button className="btn primary small-btn" disabled={disabled || busy || (!enabled && !sent)}>{busy ? "Đang lưu…" : "Lưu mật khẩu"}</button><button type="button" className="text-button" disabled={busy} onClick={() => setEditing(false)}>Hủy</button></div>
    </form>}
  </div>;
}
