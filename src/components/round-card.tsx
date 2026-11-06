"use client";
import {
  ArrowRight,
  Play,
  Users,
  Layers, CalendarDays, Timer, BadgeCheck, Trophy,
} from "lucide-react";
import RoundVisibilityButton from "./round-visibility-button";
import { coverFor } from "@/lib/task-cover";
import { duration, fmt, type ArenaData, type Action } from "./arena-client";
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
  const tasks = r.showTaskTitles ? r.taskTitles ?? [] : [];
  const covers = tasks.length ? tasks.map(t => coverFor(t.title)) : ["neutral"];
  const registration = r.registration?.status;
  return <article className={`index-row ${live ? "index-live" : ""}`}>
    <div className="index-cover" aria-hidden="true">
      {covers.map((cover, i) => <span key={i} style={{backgroundImage: `url(/round-covers/${cover}.svg)`}} />)}
    </div>
    <div className="index-body">
      <div className="index-status">
        <strong>{names[timing.phase]}</strong>
        {live && timing.seconds != null && <span className="card-clock" aria-label={`Thời gian còn lại ${duration(timing.seconds)}`}><Timer size={15}/>{duration(timing.seconds)}</span>}
        {registration === "approved" && <span className="card-registration"><BadgeCheck size={14}/>Đã đăng ký</span>}
        {registration === "pending" && <span className="card-registration">Chờ duyệt</span>}
        {r.hidden && <span className="index-hidden">Đã ẩn</span>}
      </div>
      <div className="index-title"><h2><a href={`/?round=${encodeURIComponent(r.id)}#overview`} onClick={e => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onEnter(); } }}>{r.title}</a></h2></div>
      {admin && <small className="round-source">{r.packageTitle}</small>}
      {!!tasks.length && <ul className="index-tasks" aria-label="Tên tác vụ">
        {tasks.map(t => <li key={t.id}><b>TV{t.id}</b> {t.title}</li>)}
      </ul>}
      {r.leader && r.leader.phase === timing.phase && <div className="card-leader">
        <Trophy size={16}/><span>Nhất {r.leader.split}</span><b>{r.leader.name}</b><strong>{fmt(r.leader.total)} điểm</strong>
      </div>}
    </div>
    <footer className="index-footer">
      <div className="index-count"><span className="card-date" title="Thời gian bắt đầu"><CalendarDays size={15}/>{startAt != null ? startDateFormat.format(startAt) : "Chưa đặt lịch"}</span><span><Users size={15}/>{r.registrationCount} thí sinh</span><span><Layers size={15}/>{r.taskCount} tác vụ</span></div>
      <span className="btn small-btn index-enter" aria-hidden="true">Vào vòng <ArrowRight size={15}/></span>
    </footer>
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
