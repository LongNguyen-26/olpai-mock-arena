import { roundCategories, roundSubcategoryNames, type RoundCategory, type RoundSubcategory } from "@/lib/round-classification";

const sectors: {label:string;ids:RoundSubcategory[]}[] = [
  {label:"Tổng hợp",ids:["general"]},
  {label:"Cấp độ kỳ thi",ids:["regional","national"]},
  {label:"Lĩnh vực AI",ids:["ml","nlp","vision"]},
  {label:"Phạm vi tuyển chọn",ids:["school","team","other"]},
];

export default function RoundSubcategoryOptions({category}:{category?:RoundCategory}) {
  const allowed=category?roundCategories.find(c=>c.id===category)!.subcategories:undefined;
  return <>{sectors.map(sector=>{
    const ids=sector.ids.filter(id=>!allowed||(allowed as readonly string[]).includes(id));
    return ids.length?<optgroup key={sector.label} label={sector.label}>{ids.map(id=><option key={id} value={id}>{roundSubcategoryNames[id]}</option>)}</optgroup>:null;
  })}</>;
}
