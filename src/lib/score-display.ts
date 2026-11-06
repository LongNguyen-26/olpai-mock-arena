import type { Contest, Split, TaskId } from "./types";
import type { rankTeams } from "./domain";

export const scoreModes = ["raw","baseline","board"] as const;
export type ScoreMode = typeof scoreModes[number];
export type Display = { primary:ScoreMode; extra:ScoreMode | null };
export type TaskValues = Partial<Record<TaskId,number>>;
export type Baselines = Record<Split,TaskValues>;
export const defaultDisplay:Display = {primary:"raw",extra:null};
export const scoreLabel:Record<ScoreMode,string> = {raw:"Điểm gốc",baseline:"So với baseline",board:"Theo BXH"};

export function alreadyOpened(c:Contest,now:number) {
  return !!(c.everOpened || c.practice || c.forcedEndAt || c.privateStartedAt || (c.startAt!=null && c.startAt<=now));
}
export function titlesVisible(c:Contest, now:number) {
  return c.showTaskTitles ?? !!(c.practice || (c.startAt!=null && c.startAt<=now));
}
export function convertScore(raw:number|null,mode:ScoreMode,top:number|undefined,baseline:number|undefined) {
  if(raw===null || mode==="raw") return raw;
  const floor=mode==="baseline" ? baseline : 0;
  if(floor===undefined || top===undefined || top<=floor) return 0;
  return Math.min(100,Math.max(0,100*(raw-floor)/(top-floor)));
}
export function scoreBoard(rows:ReturnType<typeof rankTeams>, ids:TaskId[], display:Display, base:TaskValues={}) {
  const tops:TaskValues={};
  for (const r of rows) for(const id of ids) {
    const v=r.scores[id];
    if(v!=null) tops[id]=Math.max(tops[id]??v,v);
  }
  const board=rows.map(r=>{
    const scores:Record<string,number|null>={}, extras:Record<string,number|null>={};
    let total=0, extraTotal=0;
    for (const id of ids) {
      const v=r.scores[id]??null;
      scores[id]=convertScore(v,display.primary,tops[id],base[id]);
      extras[id]=display.extra ? convertScore(v,display.extra,tops[id],base[id]) : null;
      total+=scores[id]??0; extraTotal+=extras[id]??0;
    }
    return {...r,scores,extras,total,extraTotal:display.extra?extraTotal:null};
  }).sort((a,b)=>b.total-a.total || b.secondary-a.secondary || a.lastAt-b.lastAt)
    .map((r,i)=>({...r,rank:i+1}));
  return {board,tops};
}
