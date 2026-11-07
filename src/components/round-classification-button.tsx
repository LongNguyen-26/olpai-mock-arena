"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Tags } from "lucide-react";
import { roundClassification, type RoundCategory, type RoundSubcategory } from "@/lib/round-classification";
import type { Action } from "./arena-client";
import RoundClassificationFields from "./round-classification-fields";
export type ClassifiableRound={id:string;runId:string;revision?:number;title:string;category?:RoundCategory;subcategory?:RoundSubcategory};
export default function RoundClassificationButton({round,busy,action}:{round:ClassifiableRound;busy:boolean;action:Action}) {
  const [selected,setSelected]=useState<ClassifiableRound|null>(null);
  return <><button type="button" className="btn small-btn" disabled={busy} onClick={()=>setSelected({...round})}><Tags size={15}/> Phân loại</button>{selected&&<ClassificationDialog round={selected} busy={busy} action={action} close={()=>setSelected(null)}/>}</>;
}
function ClassificationDialog({round,busy,action,close}:{round:ClassifiableRound;busy:boolean;action:Action;close:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null),label=useId();
  const [error,setError]=useState("");
  useEffect(()=>{const el=ref.current!;el.showModal();return()=>el.close();},[]);
  return <dialog ref={ref} className="round-policy-dialog round-management-dialog" aria-labelledby={label} onCancel={e=>{e.preventDefault();if(!busy)close();}}>
    <h2 id={label}>Phân loại vòng luyện</h2><p>{round.title}</p>
    <form onSubmit={async e=>{e.preventDefault();setError("");const f=new FormData(e.currentTarget);if(await action("admin/round/manage",{action:"classify",runId:round.runId,revision:round.revision??0,category:f.get("category"),subcategory:f.get("subcategory")},"Đã cập nhật phân loại vòng luyện.",round.id))close();else setError("Chưa lưu được. Hãy kiểm tra thông báo và tải lại dữ liệu nếu vòng vừa thay đổi.");}}>
      <RoundClassificationFields initial={roundClassification(round)} disabled={busy}/>
      {error&&<p role="alert">{error}</p>}
      <div className="action-row"><button type="button" className="btn" disabled={busy} onClick={close}>Hủy</button><button className="btn primary" disabled={busy}>Lưu phân loại</button></div>
    </form>
  </dialog>;
}
