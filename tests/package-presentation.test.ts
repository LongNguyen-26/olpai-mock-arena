import test from "node:test";
import assert from "node:assert/strict";
import { presentPackages, type PackageSummary } from "../src/lib/package-presentation";
const p = (id:string, importedAt:number, title="Bộ đề 01"):PackageSummary => ({id,title,importedAt,tasks:[]});
test("Arena identity and current/archived labels follow catalogue versions, independent of old titles", () => {
  const rows = [p("arena-01-clean-old",1), p("arena-01-standardized-v1",1000), p("arena-02-clean-old",2,"Bộ đề 02")];
  const first = presentPackages(rows);
  assert.equal(first.find(p=>p.id===rows[0].id)?.title,"Bộ đề Arena 01 · Bản cũ");
  assert.match(first.find(p=>p.id===rows[1].id)!.title,/Bộ đề Arena 01 · Bản hiện hành/);
  assert.equal(first.find(p=>p.id===rows[2].id)?.title,"Bộ đề Arena 02 · Bản cũ");
  const next = presentPackages([...rows,p("arena-01-standardized-v2",2000),p("arena-01-standardized-v3",3000)]);
  assert.match(next.find(p=>p.id===rows[1].id)!.title,/Chuẩn hóa cũ v1/);
  assert.match(next.find(p=>p.id==="arena-01-standardized-v2")!.title,/Chuẩn hóa cũ v2/);
  assert.match(next[0].title,/Bản hiện hành/);
  assert.equal(next.filter(p=>p.current).length,1);
  assert.equal(rows[0].title,"Bộ đề 01");
});
test("explicit metadata supports future package IDs and dates use Vietnam time", () => {
  const rows = presentPackages([{...p("custom-release",Date.parse("2026-11-05T18:00:00Z"),"Tên tùy ý"),arenaNumber:5,edition:"standardized"}]);
  assert.match(rows[0].title,/Bộ đề Arena 05 · Bản hiện hành/);
  assert.match(rows[0].title,/06\/11\/2026/);
  assert.match(rows[0].title,/01:00/);
});
