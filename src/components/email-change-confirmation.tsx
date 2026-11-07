"use client";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { api } from "./arena-client";
export default function EmailChangeConfirmation({
  status,
  canConfirm,
}: {
  status?: string;
  canConfirm: boolean;
}) {
  const [state, setState] = useState(
    status ?? (canConfirm ? "ready" : "invalid"),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function confirmEmail() {
    setBusy(true);
    setError("");
    try {
      const r = await api("auth/confirm-email-change", {});
      setState(r.complete ? "complete" : "waiting");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể xác nhận email.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="profile-setup-page">
      <a className="brand" href="/">
        <span className="brand-symbol">
          A<span>·</span>
        </span>
        <span>
          OlpAI<span className="brand-light"> Arena</span>
        </span>
      </a>
      <section className="panel email-change-panel">
        <MailCheck size={36} />
        <h1>
          {state === "complete"
            ? "Đã đổi email"
            : state === "waiting"
              ? "Đã nhận xác nhận"
              : "Xác nhận đổi email"}
        </h1>
        <p>
          {state === "complete"
            ? "Email tài khoản đã được cập nhật. Vui lòng đăng nhập lại để tiếp tục."
            : state === "waiting"
              ? "Hãy mở thư xác nhận còn lại trong hộp thư cũ hoặc hộp thư mới để hoàn tất. Email chỉ đổi sau khi đủ xác nhận."
              : state === "invalid"
                ? "Liên kết không hợp lệ hoặc đã hết hạn. Hãy mở lại thư xác nhận, hoặc gửi yêu cầu mới từ Tài khoản."
                : "Bấm xác nhận nếu bạn đã yêu cầu thay đổi địa chỉ email của tài khoản OlpAI Arena."}
        </p>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {state === "ready" && (
          <button
            className="btn primary"
            disabled={busy}
            onClick={confirmEmail}
          >
            {busy ? "Đang xác nhận…" : "Xác nhận đổi email"}
          </button>
        )}
        <a
          className="text-button"
          href={state === "complete" ? "/login" : "/#settings"}
        >
          {state === "complete" ? "Đăng nhập" : "Về Tài khoản"}
        </a>
      </section>
    </main>
  );
}
