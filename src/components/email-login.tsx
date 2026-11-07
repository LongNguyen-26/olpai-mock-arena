"use client";
import { useState } from "react";
import { api } from "./arena-client";
export default function EmailLogin({canConfirm}:{canConfirm:boolean}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  return <main className="email-confirmation-page"><section className="panel narrow-panel"><h1>Đăng nhập bằng email</h1><p>{canConfirm ? "Tiếp tục để đăng nhập bằng liên kết một lần của bạn." : "Liên kết không còn hợp lệ. Hãy gửi lại email đăng nhập."}</p>{error && <p role="alert" className="alert error">{error}</p>}{canConfirm && <button className="btn primary" disabled={busy} onClick={async()=>{setBusy(true);setError("");try {const result=await api("auth/confirm-login",{});window.location.assign(result.next);} catch(e){setError(e instanceof Error ? e.message : "Không thể đăng nhập.");setBusy(false);}}}>{busy ? "Đang xác nhận…" : "Xác nhận đăng nhập"}</button>}<p><a href="/login">Quay lại đăng nhập</a></p></section></main>;
}
