"use client";
import { useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, Flame, Plus, Trophy, Users } from "lucide-react";
import { phaseOf } from "@/lib/domain";
import { recentRounds, roundCategories, roundSubcategoryIds, roundSubcategoryNames, type RoundCategory } from "@/lib/round-classification";
import { type ViewProps, type ArenaData } from "./arena-client";
import RoundCard from "./round-card";
import { PublishRound } from "./round-admin";

type CategoryFilter = "all" | RoundCategory;
const categoryIcons = { mock: Trophy, topic: BookOpen, selection: Users };
export default function RoundDirectory({data,busy,action,now,onEnter}:ViewProps & {now:number;onEnter:(id:string)=>void}) {
  const [category,setCategory]=useState<CategoryFilter>("all"),[query,setQuery]=useState("");
  const [status,setStatus]=useState("all"),[subcategory,setSubcategory]=useState("all"),[sort,setSort]=useState("recent");
  const [expanded,setExpanded]=useState(false),[page,setPage]=useState(1),[publishing,setPublishing]=useState(false);
  const admin=!!data.user?.admin;
  const filtered=data.rounds.filter(r=>{
    const phase=phaseOf(r,now);
    const state=phase==="practice"?"practice":["public","private"].includes(phase)?"live":phase==="ended"?"ended":"upcoming";
    return (category==="all"||r.category===category)&&(subcategory==="all"||r.subcategory===subcategory)
      &&(status==="all"||status===state)&&r.title.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"));
  });
  const sorted=sort==="recent"?recentRounds(filtered,now):sort==="title"?[...filtered].sort((a,b)=>a.title.localeCompare(b.title,"vi")):filtered;
  const overview=!expanded&&category==="all"&&!query.trim()&&status==="all"&&subcategory==="all"&&sort==="recent";
  const pages=Math.max(1,Math.ceil(sorted.length/8)),currentPage=Math.min(page,pages);
  function selectCategory(next:CategoryFilter,all=false) {setCategory(next);setSubcategory("all");setPage(1);setExpanded(all||next!=="all");}
  function reset() {setCategory("all");setQuery("");setStatus("all");setSubcategory("all");setSort("recent");setExpanded(false);setPage(1);}
  function cards(rounds:ArenaData["rounds"]) {
    return <div className="round-directory-grid">{rounds.map(r=><RoundCard key={r.id} round={r} now={now} onEnter={()=>onEnter(r.id)} admin={admin} busy={busy} action={action} order={data.rounds.map(r=>r.id)}
      onVisibility={hidden=>void action("admin/control",{action:"visibility",hidden},hidden?"Đã ẩn vòng luyện.":"Đã hiển thị vòng luyện.",r.id)}
      onStart={()=>{if(confirm(`Bắt đầu ${r.title} và mở đề/public test cho thí sinh đã đăng ký?`))void action("admin/control",{action:"start"},"Đã bắt đầu vòng luyện.",r.id);}}/>)}</div>;
  }
  function preview(title:string,description:string,icon:ReactNode,rounds:ArenaData["rounds"],limit:number,next:CategoryFilter) {
    return <section className="directory-section" data-group={title==="Mới nhất"?"latest":next} aria-label={title} key={title}>
      <div className="directory-section-heading"><div><h2>{icon}{title}</h2><p>{description}</p></div>
        <button type="button" className="text-button directory-view-all" disabled={!rounds.length} onClick={()=>selectCategory(next,true)}>Xem tất cả ({rounds.length})<ArrowRight size={17}/></button>
      </div>
      {rounds.length?cards(rounds.slice(0,limit)):<p className="directory-empty">Chưa có vòng luyện trong nhóm này.</p>}
    </section>;
  }
  return <div className="round-directory">
    {admin&&<div className="directory-heading">
      <button type="button" className={`btn ${publishing?"":"primary"}`} onClick={()=>setPublishing(!publishing)} aria-expanded={publishing}><Plus size={18}/>{publishing?"Quay lại danh sách":"Phát hành vòng luyện"}</button>
    </div>}
    {publishing&&admin?<PublishRound data={data} busy={busy} action={action} onPublished={()=>{setPublishing(false);reset();}}/>:<>
      <div className="directory-toolbar">
        <div className="directory-filters">
          <label className="directory-search">Tìm vòng luyện<input type="search" placeholder="Nhập tên vòng luyện…" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label>
          <label>Nhóm vòng luyện<select value={category} onChange={e=>selectCategory(e.target.value as CategoryFilter)}><option value="all">Tất cả</option>{roundCategories.map(c=><option key={c.id} value={c.id}>{c.short}</option>)}</select></label>
          <label>Phân loại phụ<select value={subcategory} onChange={e=>{setSubcategory(e.target.value);setPage(1);}}><option value="all">Tất cả</option>{(category==="all"?roundSubcategoryIds:roundCategories.find(c=>c.id===category)!.subcategories).map(id=><option key={id} value={id}>{roundSubcategoryNames[id]}</option>)}</select></label>
          <label>Trạng thái<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">Tất cả</option><option value="upcoming">Sắp diễn ra / Chưa mở</option><option value="live">Đang thi</option><option value="practice">Luyện lại</option><option value="ended">Đã kết thúc</option></select></label>
          <label>Sắp xếp<select value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}><option value="recent">Mới nhất</option><option value="catalogue">Thứ tự danh sách</option><option value="title">Tên A–Z</option></select></label>
        </div>
      </div>
      {overview?<>
        {preview("Mới nhất","Đang diễn ra & sắp mở",<Flame size={23}/>,recentRounds(data.rounds,now),4,"all")}
        {roundCategories.map(c=>{const Icon=categoryIcons[c.id];return preview(c.title,c.description,<Icon size={23}/>,recentRounds(data.rounds.filter(r=>r.category===c.id),now),2,c.id);})}
      </>:<section className="directory-section" aria-label="Kết quả vòng luyện">
        <div className="directory-section-heading"><div><h2>{category==="all"?"Tất cả vòng luyện":roundCategories.find(c=>c.id===category)!.title}</h2><p>{sorted.length} vòng luyện phù hợp</p></div><button type="button" className="text-button directory-view-all" onClick={reset}>Về tổng quan</button></div>
        {sorted.length?cards(sorted.slice((currentPage-1)*8,currentPage*8)):<p className="directory-empty">Không có vòng khớp với bộ lọc. Thử đổi từ khóa hoặc nhóm vòng luyện.</p>}
        {pages>1&&<nav className="directory-pagination" aria-label="Phân trang vòng luyện"><button className="btn" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Trang trước</button><span>Trang {currentPage} / {pages}</span><button className="btn" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>Trang sau</button></nav>}
      </section>}
    </>}
  </div>;
}
