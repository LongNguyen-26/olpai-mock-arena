"use client";
import { LogOut, Plus, Send, ShieldCheck, Users } from "lucide-react";
import { api, type ViewProps } from "./arena-client";
export async function signOut() {
  await api("auth/logout", {});
  window.location.href = "/login";
}
export function TeamView({ data, busy, action }: ViewProps) {
  return (
    <>
      {data.team ? (
        <div className="team-grid">
          <section className="panel team-panel">
            <div className="team-heading">
              <span className="team-emblem">
                <Users size={30} />
              </span>
              <div>
                <h2>{data.team.name}</h2>
                <p>{data.team.members.length}/3 thành viên</p>
              </div>
            </div>
            {data.team.members.map((m) => (
              <div className="member" key={m.id}>
                <span className="avatar">{m.name.slice(0, 1)}</span>
                <span>
                  <b>
                    {m.name}
                    {m.id === data.user.id ? " (bạn)" : ""}
                  </b>
                  <small>@{m.username}</small>
                </span>
                <span className="pill neutral">
                  {m.id === data.team?.captainId ? "Đội trưởng" : "Thành viên"}
                </span>
              </div>
            ))}
            <button
              className="btn danger-ghost"
              disabled={busy}
              onClick={() => {
                if (confirm("Rời đội hiện tại?"))
                  void action("team", { action: "leave" }, "Đã rời đội.");
              }}
            >
              Rời đội
            </button>
          </section>
          <section className="panel">
            <h3>Mời thành viên</h3>
            <div className="invite-code">
              <code>{data.team.inviteCode}</code>
              <button
                className="text-button"
                onClick={() =>
                  navigator.clipboard.writeText(data.team!.inviteCode)
                }
              >
                Sao chép
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(
                  "team",
                  {
                    action: "invite",
                    username: new FormData(e.currentTarget).get("username"),
                  },
                  "Đã gửi lời mời.",
                );
              }}
            >
              <label>
                Tên đăng nhập
                <input name="username" required minLength={3} maxLength={24} />
              </label>
              <button className="btn primary" disabled={busy}>
                <Send size={16} />
                Gửi lời mời
              </button>
            </form>
          </section>
        </div>
      ) : (
        <div className="team-grid">
          <section className="panel">
            <h2>Tạo đội</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(
                  "team",
                  {
                    action: "create",
                    name: new FormData(e.currentTarget).get("name"),
                  },
                  "Đã tạo đội.",
                );
              }}
            >
              <label>
                Tên đội
                <input name="name" required minLength={2} maxLength={50} />
              </label>
              <button className="btn primary" disabled={busy}>
                <Plus size={16} />
                Tạo đội
              </button>
            </form>
          </section>
          <section className="panel">
            <h2>Tham gia đội</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(
                  "team",
                  {
                    action: "join",
                    code: new FormData(e.currentTarget).get("code"),
                  },
                  "Đã tham gia đội.",
                );
              }}
            >
              <label>
                Mã mời
                <input name="code" required />
              </label>
              <button className="btn" disabled={busy}>
                <Users size={16} />
                Tham gia
              </button>
            </form>
          </section>
        </div>
      )}
      {data.invites.length > 0 && (
        <section className="panel">
          <h3>Lời mời</h3>
          {data.invites.map((t) => (
            <div className="member" key={t.id}>
              <span>
                <b>{t.name}</b>
              </span>
              <button
                className="btn small-btn"
                disabled={busy}
                onClick={() =>
                  action(
                    "team",
                    { action: "join", teamId: t.id },
                    "Đã tham gia đội.",
                  )
                }
              >
                Chấp nhận
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  action("team", { action: "decline", teamId: t.id })
                }
              >
                Từ chối
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
export function ProfileView({ data, busy, action }: ViewProps) {
  return (
    <section className="panel narrow-panel">
      <h2>Tài khoản</h2>
      <p>
        {data.user.name} · @{data.user.username}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void action("password", Object.fromEntries(f), "Đã đổi mật khẩu.");
          e.currentTarget.reset();
        }}
      >
        <label>
          Mật khẩu hiện tại
          <input
            type="password"
            name="current"
            required
            autoComplete="current-password"
          />
        </label>
        <label>
          Mật khẩu mới
          <input
            type="password"
            name="password"
            minLength={10}
            maxLength={128}
            required
            autoComplete="new-password"
          />
        </label>
        <button className="btn primary" disabled={busy}>
          <ShieldCheck size={16} />
          Đổi mật khẩu
        </button>
      </form>
      <button className="btn danger-ghost profile-signout" onClick={signOut}>
        <LogOut size={16} />
        Đăng xuất
      </button>
    </section>
  );
}
