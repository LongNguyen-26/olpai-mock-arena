"use client";
import {
  ArrowRight,
  Play,
  Users,
  Layers,
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

const coverThemes: [RegExp, string][] = [
  [/thú cưng/i, "pets"],
  [/nhà hàng/i, "restaurant"],
  [/phụ tải điện/i, "power"],
  [/nhiều cảm xúc/i, "emotions"],
  [/tế bào/i, "cells"],
  [/đọc hiểu/i, "reading"],
  [/đồ ăn/i, "delivery"],
  [/khách hàng/i, "reviews"],
  [/máy bơm/i, "pump"],
  [/hành khách/i, "transit"],
  [/bến kênh/i, "canal"],
];

function coverFor(title: string) {
  return coverThemes.find(([pattern]) => pattern.test(title))?.[1] ?? "neutral";
}

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
        {r.hidden && <span className="index-hidden">Đã ẩn</span>}
      </div>
      <div className="index-title"><h2><a href={`/?round=${encodeURIComponent(r.id)}#overview`} onClick={e => { e.preventDefault(); onEnter(); }}>{r.title}</a></h2></div>
      {admin && <small className="round-source">{r.packageTitle}</small>}
      {!!tasks.length && <ul className="index-tasks" aria-label="Tên tác vụ">
        {tasks.map(t => <li key={t.id}><b>TV{t.id}</b> {t.title}</li>)}
      </ul>}
      <div className="index-meta">
        <span title="Thời gian bắt đầu">{startAt != null ? startDateFormat.format(startAt) : "Chưa đặt lịch"}{live && timing.seconds != null && ` · còn ${duration(timing.seconds)}`}</span>
        {registration === "approved" && <span>Đã đăng ký</span>}
        {registration === "pending" && <span>Chờ duyệt</span>}
      </div>
    </div>
    <footer className="index-footer">
      <div className="index-count"><span><Users size={15}/>{r.registrationCount} thí sinh</span><span><Layers size={15}/>{r.taskCount} tác vụ</span></div>
      <button className="btn small-btn index-enter" onClick={onEnter}>Vào vòng <ArrowRight size={15}/></button>
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
