"use client";
import { useState } from "react";
import { defaultRoundSubcategory, roundCategories, type RoundClassification, type RoundCategory, type RoundSubcategory } from "@/lib/round-classification";
import RoundSubcategoryOptions from "./round-subcategory-options";
export default function RoundClassificationFields({initial={category:"mock",subcategory:"general"},disabled=false}:{initial?:RoundClassification;disabled?:boolean}) {
  const [category,setCategory]=useState<RoundCategory>(initial.category),[subcategory,setSubcategory]=useState<RoundSubcategory>(initial.subcategory);
  return <>
    <label>Nhóm vòng luyện<select name="category" value={category} disabled={disabled} required onChange={e=>{const next=e.target.value as RoundCategory;setCategory(next);setSubcategory(defaultRoundSubcategory(next));}}>{roundCategories.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
    <label>Phân loại phụ<select name="subcategory" value={subcategory} disabled={disabled} required onChange={e=>setSubcategory(e.target.value as RoundSubcategory)}><RoundSubcategoryOptions category={category}/></select></label>
  </>;
}
