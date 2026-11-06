"use client";
import { useState } from "react";
import { ArrowRight, UserRound } from "lucide-react";
import { api } from "./arena-client";
import { profileName } from "@/lib/auth-input";
export default function ProfileSetup({next}:{next:string}) {
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setError("");
    const parsed = profileName.safeParse(new FormData(event.currentTarget).get("name"));
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Tên chưa hợp lệ."); return; }
    setBusy(true);
    try { await api("auth/profile",{name:parsed.data});window.location.assign(next); }
    catch(error) {setError(error instanceof Error?error.message:"Không thể lưu tên.");setBusy(false);}
  }
  async function leave() {
    setBusy(true);setError("");
    try {await api("auth/logout",{});window.location.assign("/");}
    catch(error) {setError(error instanceof Error?error.message:"Không thể đăng xuất.");setBusy(false);}
  }
  return <main className="profile-setup-page">
    <a className="brand" href="/"><span className="brand-symbol">A<span>·</span></span><span>OlpAI<span className="brand-light"> Arena</span></span></a>
    <section className="panel profile-setup-panel">
      <span className="profile-setup-icon" aria-hidden="true"><UserRound size={28}/></span>
      <span className="eyebrow muted">HOÀN TẤT TÀI KHOẢN</span>
      <h1>Bạn muốn được gọi là gì?</h1>
      <p>Nhập tên của bạn để sử dụng trong đội và trên OlpAI Arena.</p>
      <form onSubmit={submit}>
        <label>Tên của bạn<input name="name" autoComplete="name" placeholder="Nguyễn Minh Anh" minLength={2} maxLength={60} required autoFocus disabled={busy}/></label>
        <small>Bạn chỉ cần nhập tên một lần. Những lần đăng nhập sau sẽ dùng tên đã chọn.</small>
        {error && <div className="alert error" role="alert">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy?"Đang lưu…":"Lưu tên và tiếp tục"}<ArrowRight size={18}/></button>
      </form>
      <button className="text-button" type="button" disabled={busy} onClick={leave}>Đăng xuất và quay lại</button>
    </section>
  </main>;
}
