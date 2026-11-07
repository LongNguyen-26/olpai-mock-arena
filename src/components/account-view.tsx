"use client";
import { useState } from "react";
import { LogOut, Pencil, ShieldCheck } from "lucide-react";
import { api, type ViewProps } from "./arena-client";
const date = (value: number) =>
  new Date(value).toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
export default function ProfileView({
  data,
  busy,
  action,
  onRefresh,
}: ViewProps & { onRefresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<"name" | "email" | null>(null);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const google = data.user?.loginProvider === "google";
  const googleReauth = google || data.user?.authMethod === "legacy";
  const disabled = busy || saving;
  const nameReady =
    !data.account?.nameChangeAt || Date.now() >= data.account.nameChangeAt;
  const emailReady =
    !data.account?.emailChangeAt || Date.now() >= data.account.emailChangeAt;
  function edit(field: "name" | "email") {
    setEditing(editing === field ? null : field);
    setError("");
    setNotice("");
  }
  async function linkGoogle() {
    setSaving(true);
    setError("");
    try {
      const r = await api("auth/google", { link: true, next: "/#settings" });
      window.location.assign(r.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể mở Google.");
      setSaving(false);
    }
  }
  async function changeEmail(form: HTMLFormElement) {
    const input = Object.fromEntries(new FormData(form));
    if (
      !confirm(
        `Gửi yêu cầu đổi email sang ${input.email}? Bạn sẽ cần xác nhận qua email.`,
      )
    )
      return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await api("auth/change-email", input);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setEditing(null);
      setNotice(
        "Đã gửi thư xác nhận. Kiểm tra cả hộp thư hiện tại và hộp thư mới để hoàn tất.",
      );
      await onRefresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thể gửi yêu cầu đổi email.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel narrow-panel account-panel">
      <div className="account-title">
        <h2>Tài khoản</h2>
        <span className="pill neutral">
          {google
            ? "Google"
            : data.user?.authMethod === "supabase"
              ? "Email"
              : "Tài khoản Arena"}
        </span>
      </div>
      <p className="account-intro">Thông tin cá nhân và bảo mật của bạn.</p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert auth-notice" role="status">
          {notice}
        </p>
      )}
      <div className="account-detail">
        <div className="account-detail-row">
          <div>
            <h3>Tên hiển thị</h3>
            <p>{data.user?.name}</p>
            <small>
              {nameReady
                ? "Có thể đổi tên một lần mỗi 30 ngày."
                : `Có thể đổi lại từ ${date(data.account!.nameChangeAt!)}.`}
            </small>
          </div>
          <button
            type="button"
            className="text-button account-edit"
            disabled={disabled || !nameReady}
            onClick={() => edit("name")}
            aria-expanded={editing === "name"}
          >
            <Pencil size={15} />
            Đổi tên
          </button>
        </div>
        {editing === "name" && (
          <form
            className="account-edit-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name");
              if (!confirm("Lưu tên mới? Bạn có thể đổi lại sau 30 ngày."))
                return;
              if (await action("auth/name", { name }, "Đã đổi tên hiển thị."))
                setEditing(null);
            }}
          >
            <label>
              Tên mới
              <input
                name="name"
                defaultValue={data.user?.name}
                minLength={2}
                maxLength={60}
                autoComplete="name"
                required
                autoFocus
              />
            </label>
            <div className="account-form-actions">
              <button className="btn primary small-btn" disabled={disabled}>
                Lưu tên
              </button>
              <button
                type="button"
                className="text-button"
                disabled={disabled}
                onClick={() => setEditing(null)}
              >
                Hủy
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="account-detail">
        <div className="account-detail-row">
          <div>
            <h3>Email</h3>
            <p>
              {data.user?.username.includes("@")
                ? data.user.username
                : "Chưa liên kết email xác thực"}
            </p>
            <small>
              {emailReady
                ? "Đổi email cần xác nhận. Mỗi 30 ngày một lần."
                : `Có thể đổi lại từ ${date(data.account!.emailChangeAt!)}.`}
            </small>
          </div>
          <button
            type="button"
            className="text-button account-edit"
            disabled={disabled || !emailReady || !data.account?.canChangeEmail}
            onClick={() => edit("email")}
            aria-expanded={editing === "email"}
          >
            <Pencil size={15} />
            Đổi email
          </button>
        </div>
        {data.account?.pendingEmail && (
          <p className="account-pending" role="status">
            Chờ xác nhận: <strong>{data.account.pendingEmail}</strong>. Kiểm tra
            thư ở cả hai địa chỉ email.
          </p>
        )}
        {editing === "email" && (
          <form
            className="account-edit-form"
            onSubmit={(e) => {
              e.preventDefault();
              void changeEmail(e.currentTarget);
            }}
          >
            <label>
              Email mới
              <input
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
              />
            </label>
            {googleReauth ? (
              <p className="account-reauth-note">
                Xác thực lại bằng đúng tài khoản Google trước khi gửi thư xác
                nhận. Địa chỉ mới áp dụng trong Arena; bạn vẫn đăng nhập bằng tài khoản Google hiện tại.
              </p>
            ) : (
              <label>
                Mật khẩu hiện tại
                <input
                  type="password"
                  name="current"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
            )}
            <input
              type="hidden"
              name="username"
              autoComplete="username"
              value={data.user?.username ?? ""}
            />
            <div className="account-form-actions">
              <button className="btn primary small-btn" disabled={disabled}>
                {saving
                  ? "Đang xử lý…"
                  : googleReauth
                    ? "Xác thực bằng Google"
                    : "Gửi xác nhận"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={disabled}
                onClick={() => setEditing(null)}
              >
                Hủy
              </button>
            </div>
          </form>
        )}
      </div>
      {data.auth?.google && !data.authLinked && (
        <div className="account-detail">
          <h3>Liên kết Google</h3>
          <p className="account-reauth-note">
            Liên kết để đăng nhập bằng Google và sử dụng email xác thực.
          </p>
          <button
            type="button"
            className="btn small-btn"
            disabled={disabled}
            onClick={linkGoogle}
          >
            Liên kết Google
          </button>
        </div>
      )}
      {!google && (
        <div className="account-detail account-password">
          <h3>Đổi mật khẩu</h3>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              if (
                await action(
                  "password",
                  Object.fromEntries(new FormData(form)),
                  "Đã đổi mật khẩu.",
                )
              )
                form.reset();
            }}
          >
            <input
              type="hidden"
              name="username"
              autoComplete="username"
              value={data.user?.username ?? ""}
            />
            <label>
              Mật khẩu hiện tại
              <input
                type="password"
                name="current"
                required
                maxLength={128}
                autoComplete="current-password"
              />
            </label>
            <label>
              Mật khẩu mới
              <input
                type="password"
                name="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <button className="btn primary small-btn" disabled={disabled}>
              <ShieldCheck size={16} />
              Đổi mật khẩu
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="btn danger-ghost profile-signout"
        disabled={disabled}
        onClick={async () => {
          await api("auth/logout", {});
          window.location.href = "/";
        }}
      >
        <LogOut size={16} />
        Đăng xuất
      </button>
    </section>
  );
}
