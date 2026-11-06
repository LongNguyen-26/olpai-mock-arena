"use client";
import { useEffect, useId, useRef, useState } from "react";
import { alreadyOpened, scoreModes, scoreLabel, type ScoreMode } from "@/lib/score-display";
import { fmt, type ArenaData, type ViewProps } from "./arena-client";

export function ScoreNote({data,split}:{data:ArenaData;split:"public"|"private"}) {
  const policy=data.scoreDisplay;
  const base=data.baselineScores?.[split];
  const modes=[policy.primary,policy.extra];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="score-help" ref={ref}
    onPointerEnter={e => { if (e.pointerType === "mouse") setOpen(true); }}
    onPointerLeave={e => { if (e.pointerType === "mouse") setOpen(false); }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <button className="score-help-trigger" type="button" aria-label="Cách tính điểm" aria-expanded={open}
      aria-controls={id} onFocus={e => { if (e.target.matches(":focus-visible")) setOpen(true); }}
      onClick={() => setOpen(true)}>?</button>
    <div id={id} hidden={!open} className="score-flyout"><div className="score-note"><b>Điểm xếp hạng: {scoreLabel[policy.primary]}</b>
    {policy.extra && <> · Điểm phụ: {scoreLabel[policy.extra]}</>}
    {modes.includes("board") && <small>Theo BXH = 100 × điểm gốc / điểm tốt nhất của tác vụ trong tập {split}.</small>}
    {modes.includes("baseline") && <small>So với baseline = 100 × (điểm gốc − baseline) / (điểm tốt nhất − baseline). Chưa vượt baseline nhận 0.</small>}
    {modes.some(m=>m && m!=="raw") && <small>Mốc tốt nhất lấy từ bài hợp lệ của đội thi, cập nhật theo BXH. Khi chưa có mốc dương để chuẩn hóa, điểm là 0.</small>}
    {base && <small>Baseline {split}: {Object.entries(base).map(([id,n])=>"TV"+id+" · "+fmt(n)).join("　|　")}</small>}
  </div></div></div>
}
export default function ScoreSettings({data,busy,action}:ViewProps) {
  const c=data.contest!, saved=data.scoreDisplay;
  const [primary,setPrimary]=useState(saved.primary);
  const [extra,setExtra]=useState<ScoreMode|"">(saved.extra??"");
  const available=!!data.baselineScores;
  const changed=primary!==saved.primary || extra!==(saved.extra??"");
  return <details className="scoring-settings"><summary><strong>Cách hiển thị điểm</strong>
    <span>{scoreLabel[saved.primary]}{saved.extra && ` · Phụ: ${scoreLabel[saved.extra]}`}</span></summary>
    <div className="scoring-editor">
    <div className="scoring-options"><label>Điểm chính · dùng xếp hạng<select value={primary} onChange={e=>{
      const value=e.target.value as ScoreMode;setPrimary(value);if(extra===value)setExtra("");
    }}>{scoreModes.map(m=><option key={m} value={m} disabled={m==="baseline"&&!available}>{scoreLabel[m]}</option>)}</select></label>
    <label>Điểm phụ<select value={extra} onChange={e=>setExtra(e.target.value as ScoreMode|"")}><option value="">Không hiển thị</option>
    {scoreModes.filter(m=>m!==primary).map(m=><option key={m} value={m} disabled={m==="baseline"&&!available}>{scoreLabel[m]}</option>)}</select></label>
    <button className="btn small-btn" disabled={busy||!changed} onClick={()=>{
      const opened=alreadyOpened(c,Math.max(Date.now(),data.serverNow));
      if(opened && !window.confirm("Đổi cách hiển thị điểm cho vòng đã mở? Bài nộp cũ sẽ hiển thị theo cấu hình mới. Đổi điểm chính có thể thay đổi thứ hạng."))return;
      void action("admin/control",{action:"score-display",primary,extra:extra||null,confirmed:opened,revision:c.revision??0,runId:c.id,requestId:crypto.randomUUID()},"Đã cập nhật cách hiển thị điểm.",c.roundId);
    }}>Lưu cách hiển thị</button>
    </div>
    {available ? <p>{(["public","private"] as const).map(s=><small key={s}>Baseline {s}: {Object.entries(data.baselineScores![s]??{}).map(([id,n])=>"TV"+id+" = "+fmt(n)).join(" · ")} </small>)}</p> :
      <p>Bộ đề chưa lưu baseline cho đủ các tác vụ và hai tập.</p>}
    </div>
  </details>
}
