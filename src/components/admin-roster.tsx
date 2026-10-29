"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Search, Trash2, Users } from "lucide-react";
import { api, when } from "./arena-client";
import type { adminRoster } from "@/lib/admin-roster";
type Roster = Awaited<ReturnType<typeof adminRoster>>;
export default function AdminRoster() {
  const [data, setData] = useState<Roster | null>(null);
  const sequence = useRef(0);
  const [tab, setTab] = useState<"team" | "contestant">("team");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<{
    kind: "team" | "contestant";
    id: string;
    name: string;
  } | null>(null);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next: Roster = await api("admin/roster");
      if (request === sequence.current) setData(next);
    } catch (e) {
      if (request === sequence.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      clearInterval(timer);
      sequence.current++;
    };
  }, [load]);
  async function remove() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("admin/roster", { kind: selected.kind, id: selected.id });
      setSelected(null);
      setNotice("Đã xóa mục đã chọn.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const needle = query.trim().toLocaleLowerCase("vi");
  const contestants =
    data?.contestants.filter((u) =>
      `${u.name} ${u.username}`.toLocaleLowerCase("vi").includes(needle),
    ) ?? [];
  const teams =
    data?.teams.filter((t) =>
      t.name.toLocaleLowerCase("vi").includes(needle),
    ) ?? [];
  return (
    <section className="panel roster-panel">
      <div className="section-title">
        <div>
          <h2>
            <Users size={20} />
            Đội & thí sinh
          </h2>
          <p>Quản lý đội và tài khoản thí sinh trên toàn hệ thống.</p>
        </div>
        <button
          className="btn small-btn"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
          Làm mới danh sách
        </button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {selected && (
        <section
          className="roster-confirm"
          role="alertdialog"
          aria-label="Xác nhận xóa"
        >
          <h3>
            Xóa {selected.kind === "team" ? "đội" : "thí sinh"} “{selected.name}
            ”?
          </h3>
          <p>
            {selected.kind === "team"
              ? "Các thành viên vẫn giữ tài khoản và sẽ rời đội này."
              : "Tài khoản sẽ không thể đăng nhập, được gỡ khỏi đội và danh sách đăng ký các vòng."}{" "}
            Lịch sử bài nộp được giữ lại. Pod đã cấp không tự thu hồi; quản lý
            chúng trong GPU Workspace.
          </p>
          <div className="action-row">
            <button
              className="btn danger-btn"
              disabled={busy}
              onClick={() => void remove()}
            >
              Xác nhận xóa
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Giữ lại
            </button>
          </div>
        </section>
      )}
      <div className="roster-tools">
        <div className="segmented">
          <button
            className={tab === "team" ? "active" : ""}
            onClick={() => setTab("team")}
          >
            Đội ({data?.teams.length ?? 0})
          </button>
          <button
            className={tab === "contestant" ? "active" : ""}
            onClick={() => setTab("contestant")}
          >
            Thí sinh ({data?.contestants.length ?? 0})
          </button>
        </div>
        <label className="roster-search">
          <Search size={16} />
          <input
            aria-label="Tìm đội hoặc thí sinh"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tên hoặc email…"
          />
        </label>
      </div>
      {!data ? (
        <p>Đang tải danh sách…</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{tab === "team" ? "Đội" : "Thí sinh"}</th>
                <th>{tab === "team" ? "Thành viên" : "Đội hiện tại"}</th>
                <th>{tab === "team" ? "Số lượng" : "Tạo tài khoản"}</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {tab === "team"
                ? teams.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <b>{t.name}</b>
                      </td>
                      <td>
                        {t.members
                          .map(
                            (id) =>
                              data.contestants.find((u) => u.id === id)?.name ??
                              "Thành viên",
                          )
                          .join(", ") || "Chưa có thành viên"}
                      </td>
                      <td>{t.members.length}/3</td>
                      <td>
                        <button
                          className="text-button roster-delete"
                          disabled={busy}
                          onClick={() =>
                            setSelected({
                              kind: "team",
                              id: t.id,
                              name: t.name,
                            })
                          }
                        >
                          <Trash2 size={14} />
                          Xóa đội
                        </button>
                      </td>
                    </tr>
                  ))
                : contestants.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <b>{u.name}</b>
                        <small>{u.username}</small>
                      </td>
                      <td>
                        {data.teams.find((t) => t.id === u.teamId)?.name ??
                          "Chưa có đội"}
                      </td>
                      <td>{when(u.createdAt)}</td>
                      <td>
                        <button
                          className="text-button roster-delete"
                          disabled={busy}
                          onClick={() =>
                            setSelected({
                              kind: "contestant",
                              id: u.id,
                              name: u.name,
                            })
                          }
                        >
                          <Trash2 size={14} />
                          Xóa thí sinh
                        </button>
                      </td>
                    </tr>
                  ))}
              {!(tab === "team" ? teams.length : contestants.length) && (
                <tr>
                  <td colSpan={4}>Không có kết quả.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
