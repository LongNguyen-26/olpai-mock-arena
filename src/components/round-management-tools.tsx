"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowUp, ArrowDown, Pencil, Trash2 } from "lucide-react";
import type { Action } from "./arena-client";

type ManagedRound = { id: string; runId: string; revision?: number; title: string };
export default function RoundManagementTools({ round, order = [], busy, action, renameOnly = false }: {
  round: ManagedRound; order?: string[]; busy: boolean; action: Action; renameOnly?: boolean;
}) {
  const [dialog, setDialog] = useState<{ mode: "rename" | "delete"; round: ManagedRound } | null>(null);
  const index = order.indexOf(round.id);
  return <>
    {!renameOnly && <span className="round-order-actions" role="group" aria-label="Sắp xếp vòng luyện">
      <button className="btn small-btn" type="button" disabled={busy || index <= 0}
        aria-label={`Đưa ${round.title} lên`} title="Đưa lên"
        onClick={() => void action("admin/round/manage", { action:"move", direction:"up", expectedOrder:order }, "Đã đổi thứ tự vòng luyện.", round.id)}>
        <ArrowUp size={16} /> Lên
      </button>
      <button className="btn small-btn" type="button" disabled={busy || index < 0 || index === order.length - 1}
        aria-label={`Đưa ${round.title} xuống`} title="Đưa xuống"
        onClick={() => void action("admin/round/manage", { action:"move", direction:"down", expectedOrder:order }, "Đã đổi thứ tự vòng luyện.", round.id)}>
        <ArrowDown size={16} /> Xuống
      </button>
    </span>}
    <button className="btn small-btn" type="button" disabled={busy} onClick={() => setDialog({ mode:"rename", round:{...round} })}>
      <Pencil size={15} /> Đổi tên
    </button>
    {!renameOnly && <button className="btn small-btn danger-ghost" type="button" disabled={busy} onClick={() => setDialog({ mode:"delete", round:{...round} })}>
      <Trash2 size={15} /> Xóa vòng
    </button>}
    {dialog && <ManagementDialog mode={dialog.mode} round={dialog.round} busy={busy} close={() => setDialog(null)}
      submit={async title => {
        const payload = { runId:dialog.round.runId, revision:dialog.round.revision ?? 0 };
        const ok = await action("admin/round/manage", dialog.mode === "rename"
          ? { action:"rename", ...payload, title }
          : { action:"delete", ...payload, confirmTitle:dialog.round.title },
        dialog.mode === "rename" ? "Đã đổi tên vòng luyện." : "Đã xóa vòng luyện khỏi website.", dialog.round.id);
        if (ok) setDialog(null);
        return !!ok;
      }} />}
  </>;
}

function ManagementDialog({ mode, round, busy, close, submit }: {
  mode: "rename" | "delete"; round: ManagedRound; busy: boolean; close: () => void;
  submit: (title: string) => Promise<boolean>;
}) {
  const ref = useRef<HTMLDialogElement>(null), label = useId();
  // Keep the version/title captured when the dialog opened; stale forms must fail on the server.
  const [title, setTitle] = useState(round.title);
  const [error, setError] = useState("");
  useEffect(() => { const element = ref.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={ref} className="round-policy-dialog round-management-dialog" aria-labelledby={label}
    onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <h2 id={label}>{mode === "rename" ? "Đổi tên vòng luyện" : "Xóa vòng luyện?"}</h2>
    <form onSubmit={async e => {
      e.preventDefault(); setError("");
      if (!await submit(title)) setError("Chưa lưu được thay đổi. Hãy đóng hộp thoại để xem thông báo và thử lại với dữ liệu mới nhất.");
    }}>
      {mode === "rename" ? <label>Tên vòng luyện
        <input value={title} onChange={e => setTitle(e.target.value)} minLength={3} maxLength={100} required autoFocus disabled={busy} />
      </label> : <>
        <p>Vòng <strong>{round.title}</strong> sẽ bị gỡ khỏi danh sách. Mọi người sẽ không còn truy cập được vòng này.</p>
        <p>Bài nộp, kết quả và bộ đề nguồn được giữ lại để có thể khôi phục. Pod và tiến trình đang chạy vẫn được giữ.</p>
      </>}
      {error && <p role="alert">{error}</p>}
      <div className="action-row">
        <button type="button" className="btn" onClick={close} disabled={busy} autoFocus={mode === "delete"}>Hủy</button>
        <button className={`btn ${mode === "delete" ? "danger-ghost" : "primary"}`} disabled={busy || (mode === "rename" && title.trim().length < 3)}>
          {busy ? "Đang lưu…" : mode === "rename" ? "Lưu tên" : "Xác nhận xóa vòng"}
        </button>
      </div>
    </form>
  </dialog>;
}
