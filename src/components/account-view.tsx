"use client";
import { useState } from "react";
import { LogOut, Pencil, Mail, UserRound, LockKeyhole } from "lucide-react";
import { api, type ViewProps } from "./arena-client";
import AccountPassword from "./account-password";
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
  const [editing, setEditing] = useState<"name" | "email" | "school" | null>(null);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const google = !!data.account?.googleLinked;
  const passwordEnabled = data.account?.passwordEnabled ?? data.user?.authMethod === "legacy";
  const googleReauth = google || data.user?.authMethod === "legacy";
  const disabled = busy || saving;
  const nameReady =
    !data.account?.nameChangeAt || Date.now() >= data.account.nameChangeAt;
  const emailReady =
    !data.account?.emailChangeAt || Date.now() >= data.account.emailChangeAt;
  function edit(field: "name" | "email" | "school") {
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
    <section className="account-panel" aria-label="Cài đặt tài khoản">
      <div className="account-identity">
        <span className="account-avatar" aria-hidden="true"><UserRound size={32}/></span>
        <div className="account-identity-copy">
          <span className="account-eyebrow">HỒ SƠ CỦA BẠN</span>
          <h2>{data.user?.name}</h2>
          <p>{data.user?.username.includes("@") ? data.user.username : "Tài khoản Arena"}</p>
          <span className={`account-status ${data.account?.emailVerified ? "verified" : ""}`}>
            {data.account?.emailVerified ? "Email đã xác minh" : "Chưa liên kết email xác minh"}
          </span>
        </div>
        <span className="account-type">{google ? passwordEnabled ? "Google + mật khẩu" : "Tài khoản Google" : data.user?.authMethod === "supabase" ? "Tài khoản email" : "Tài khoản Arena"}</span>
      </div>
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
      <div className="account-section-heading">
        <h2>Thông tin cá nhân</h2>
        <p>Cập nhật tên hiển thị và trường của bạn.</p>
      </div>
      <div className="account-personal-grid">
      <div className="account-detail account-name">
        <h3>Tên hiển thị</h3>
        <div className="account-value-row">
          <p>{data.user?.name}</p>
          <button type="button" className="text-button account-edit" disabled={disabled || !nameReady} onClick={()=>edit("name")} aria-expanded={editing === "name"} aria-label="Đổi tên">
            <Pencil size={20}/><span className="account-action-label">Đổi tên</span>
          </button>
        </div>
        <small>{nameReady ? "Có thể đổi tên một lần mỗi 30 ngày." : `Có thể đổi lại từ ${date(data.account!.nameChangeAt!)}.`}</small>
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
      <div className="account-detail account-school">
        <h3>Trường</h3>
        <div className="account-value-row">
          <p>{data.account?.school || "Chưa cập nhật"}</p>
          <button type="button" className="text-button account-edit" disabled={disabled} onClick={()=>edit("school")} aria-expanded={editing === "school"} aria-label="Cập nhật trường">
            <Pencil size={20}/><span className="account-action-label">Cập nhật trường</span>
          </button>
        </div>
        <small>Trường đại học, học viện hoặc đơn vị bạn đang theo học.</small>
        {editing === "school" && <form className="account-edit-form" onSubmit={async e=>{
          e.preventDefault();
          const school=new FormData(e.currentTarget).get("school");
          if(await action("auth/school",{school},"Đã cập nhật trường."))setEditing(null);
        }}>
          <label>Tên trường<input name="school" defaultValue={data.account?.school ?? ""} maxLength={160} autoComplete="organization" placeholder="Ví dụ: Đại học Bách khoa – ĐH Đà Nẵng" autoFocus/></label>
          <p className="account-reauth-note">Có thể để trống nếu bạn chưa muốn thêm thông tin này.</p>
          <div className="account-form-actions">
            <button className="btn primary small-btn" disabled={disabled}>Lưu trường</button>
            <button type="button" className="text-button" disabled={disabled} onClick={()=>setEditing(null)}>Hủy</button>
          </div>
        </form>}
      </div>
      </div>
      <div className="account-section-heading account-security-heading">
        <h2>Tài khoản &amp; bảo mật</h2>
        <p>Quản lý email và các phương thức đăng nhập của bạn.</p>
      </div>
      <div className="account-detail account-email">
        <h3>Email đăng nhập</h3>
        <div className="account-value-row">
          <p>{data.user?.username.includes("@") ? data.user.username : "Chưa liên kết email xác thực"}</p>
          {data.account?.canChangeEmail ? <button type="button" className="text-button account-edit" disabled={disabled || !emailReady} onClick={()=>edit("email")} aria-expanded={editing === "email"} aria-label="Đổi email">
            <Pencil size={20}/><span className="account-action-label">Đổi email</span>
          </button> : <span className="account-status" aria-label="Email chỉ đọc"><LockKeyhole size={16}/> Chỉ đọc</span>}
        </div>
        <small>{!data.account?.canChangeEmail ? passwordEnabled ? "Liên kết Google để xác minh và quản lý email tài khoản." : "Email từ Google. Thiết lập mật khẩu để bật thay đổi email." : emailReady ? "Đổi email cần xác nhận. Mỗi 30 ngày một lần." : `Có thể đổi lại từ ${date(data.account!.emailChangeAt!)}.`}</small>
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
      <div className="account-methods-grid">
        <div className="account-detail account-method-card">
          <h3><span className="google-mark" aria-hidden="true">G</span> Google</h3>
          <div className="account-value-row">
            <div><p>Đăng nhập bằng Google</p><small>{google ? "Sử dụng tài khoản Google đã liên kết với Arena." : "Kết nối tài khoản Google để có thêm một cách đăng nhập."}</small></div>
            <span className={`account-status ${google ? "verified" : ""}`}>{google ? "Đã liên kết" : "Chưa liên kết"}</span>
          </div>
          {data.auth?.google && !data.authLinked && <button type="button" className="btn account-connect" disabled={disabled} onClick={linkGoogle}>Liên kết Google</button>}
        </div>
        {data.auth?.supabase && <div className="account-detail account-method-card">
          <h3><Mail size={24}/> Đăng nhập qua email</h3>
          <div className="account-value-row">
            <div><p>OTP hoặc Magic Link</p><small>{data.account?.emailVerified && data.user?.authMethod === "supabase" ? "Nhận mã hoặc liên kết một lần qua email, không cần mật khẩu." : "Khả dụng sau khi tài khoản có email xác minh bằng Supabase."}</small></div>
            <span className={`account-status ${data.account?.emailVerified && data.user?.authMethod === "supabase" ? "verified" : ""}`}>{data.account?.emailVerified && data.user?.authMethod === "supabase" ? "Khả dụng" : "Chưa bật"}</span>
          </div>
        </div>}
      </div>
      <AccountPassword email={data.user?.username ?? ""} enabled={passwordEnabled} disabled={disabled} onRefresh={onRefresh}/>
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
