"use client";
import {
  ArrowRight,
  Play,
} from "lucide-react";
import RoundVisibilityButton from "./round-visibility-button";
import { duration, type ArenaData, type Action } from "./arena-client";
import RoundManagementTools from "./round-management-tools";
import { roundTiming } from "@/lib/round-presentation";

const names = {
  waiting: "Chờ bắt đầu",
  scheduled: "Sắp diễn ra",
  public: "Đang mở · Public",
  private: "Đang mở · Private",
  practice: "Đang mở · Luyện tập tiếp",
  ended: "Đã kết thúc",
};
const startDateFormat = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default function RoundCard({
  round: r,
  now,
  onEnter,
  admin = false,
  busy = false,
  onStart,
  onVisibility,
  order = [],
  action,
}: {
  round: ArenaData["rounds"][number];
  now: number;
  onEnter: () => void;
  admin?: boolean;
  busy?: boolean;
  onStart?: () => void;
  onVisibility?: (hidden: boolean) => void;
  order?: string[];
  action?: Action;
}) {
  const timing = roundTiming(r, now);
  const live = ["public", "private", "practice"].includes(timing.phase);
  const startAt = r.practice?.startAt ?? r.startAt;
  return <article className={`round-card index-row ${live ? "index-live" : ""}`}>
    <div className="index-info">
      <div className="index-title"><h2><a href={`/?round=${encodeURIComponent(r.id)}#overview`} onClick={e=>{e.preventDefault();onEnter();}}>{r.title}</a></h2>
      {r.hidden && <span className="index-hidden">Đã ẩn</span>}</div>
      {admin && <small className="round-source">{r.packageTitle}</small>}
      {r.showTaskTitles && !!r.taskTitles?.length && <ul className="index-tasks" aria-label="Tên tác vụ">{r.taskTitles.map(t=><li key={t.id}><b>TV{t.id}</b> {t.title}</li>)}</ul>}
    </div>
    <div className="index-status"><strong>{names[timing.phase]}</strong>
      <small>{startAt!=null ? startDateFormat.format(startAt) : "Chưa đặt lịch"}{live && timing.seconds!=null ? " · còn "+duration(timing.seconds):""}</small>
    </div>
    <div className="index-count"><b>{r.registrationCount}</b> thí sinh <small>{r.taskCount} tác vụ{r.registration?.status==="approved"?" · Đã đăng ký":r.registration?.status==="pending"?" · Chờ duyệt":""}</small></div>
    <div className="index-go"><button className="btn small-btn" onClick={onEnter}>Vào vòng <ArrowRight size={14}/></button></div>
    {admin && <details className="index-management"><summary>Quản trị</summary><div className="round-admin-actions">
      {["waiting","scheduled"].includes(timing.phase) && <button className="btn small-btn" disabled={busy} onClick={onStart}><Play size={14}/>Bắt đầu</button>}
      <RoundVisibilityButton hidden={r.hidden} title={r.title} busy={busy} onChange={v=>onVisibility?.(v)}/>
      {action && <><button className="btn small-btn" disabled={busy} onClick={()=>void action("admin/control",{
        action:"task-titles",show:!r.showTaskTitles,runId:r.runId,revision:r.revision,requestId:crypto.randomUUID()
      },r.showTaskTitles?"Đã ẩn tên tác vụ.":"Đã hiện tên tác vụ.",r.id)}>{r.showTaskTitles?"Ẩn tên tác vụ":"Hiện tên tác vụ"}</button>
      <RoundManagementTools round={r} order={order} busy={busy} action={action}/></>}
    </div></details>}
  </article>;
}