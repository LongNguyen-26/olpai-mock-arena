import { fromBufferPromise } from "yauzl";
import { crc32 } from "node:zlib";
import { z } from "zod";
import { submissionRows, SubmissionError } from "./judge";
import type { JudgeResult, TaskStatement } from "./types";

type Kind = NonNullable<TaskStatement["zipJudge"]>;
const maxExpanded = 16 * 1024 * 1024;
const coordinate = z.number().min(1).max(9).refine(n => Math.round(n * 100) / 100 === n);
const aspect = z.object({aspect:z.string(), valence:coordinate, arousal:coordinate});
const quad = aspect.extend({category:z.string(), opinion:z.string()});
const first = z.object({id:z.string(), aspects:z.array(aspect)});
const second = z.object({id:z.string(), quadruplets:z.array(quad)});
type Aspect = z.infer<typeof aspect>;
type Quad = z.infer<typeof quad>;
type NLPTruth = {subtask1:z.infer<typeof first>[]; subtask2:z.infer<typeof second>[]};
type Position = [string,number];
type CVTruth = {queries:Record<string,Position>; database:Record<string,Position>};

async function readZip(bytes: Uint8Array, names: string[]) {
  const files = new Map<string,string>();
  try {
    const zip = await fromBufferPromise(Buffer.from(bytes), {strictFileNames:true,lazyEntries:true});
    try {
      if (zip.entryCount !== names.length) throw new Error();
      let total = 0;
      for await (const entry of zip.eachEntry()) {
        total += entry.uncompressedSize;
        if (total > maxExpanded || !names.includes(entry.fileName) || files.has(entry.fileName) || entry.isEncrypted()) throw new Error();
        const chunks:Buffer[] = [];
        let size = 0;
        for await (const chunk of await zip.openReadStreamPromise(entry)) {
          size += chunk.length;
          if (size > entry.uncompressedSize) throw new Error();
          chunks.push(chunk);
        }
        const content = Buffer.concat(chunks);
        if (size !== entry.uncompressedSize || crc32(content) !== entry.crc32) throw new Error();
        files.set(entry.fileName,new TextDecoder("utf-8",{fatal:true}).decode(content));
      }
    } finally { zip.close(); }
  } catch {
    throw new SubmissionError("ZIP không hợp lệ. Đặt đúng các tệp UTF-8 ở gốc ZIP, tối đa 16 MiB sau giải nén.");
  }
  return files;
}

function* predictions<T extends {id:string}>(text:string, schema:z.ZodType<T>, gold:Map<string,T>) {
  const seen = new Set<string>();
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) continue;
    let row:T;
    try { row = schema.parse(JSON.parse(match[0])); }
    catch { throw new SubmissionError("Dòng JSONL sai cấu trúc hoặc giá trị cảm xúc không hợp lệ."); }
    const expected = gold.get(row.id);
    if (!expected || seen.has(row.id)) throw new SubmissionError("ID không tồn tại hoặc bị lặp.");
    seen.add(row.id);
    yield [row,expected] as const;
  }
  if (seen.size !== gold.size) throw new SubmissionError("Thiếu ID trong tệp JSONL.");
}

const distance = (a:Aspect,b:Aspect) => Math.hypot(a.valence-b.valence,a.arousal-b.arousal);
const triple = (q:Quad) => JSON.stringify([q.aspect,q.category,q.opinion]);
function judgeNLP(files:Map<string,string>, truth:NLPTruth):JudgeResult {
  const diameter = Math.sqrt(128);
  let squared = 0, count = 0, mass = 0, denominator = 0;
  for (const [row,gold] of predictions(files.get("subtask1.jsonl")!,first,new Map(truth.subtask1.map(r=>[r.id,r])))) {
    if (row.aspects.length !== gold.aspects.length || row.aspects.some((a,i)=>a.aspect!==gold.aspects[i].aspect))
      throw new SubmissionError("Sai danh sách hoặc thứ tự aspect.");
    row.aspects.forEach((a,i)=>{ squared += distance(a,gold.aspects[i])**2; count++; });
  }
  for (const [row,gold] of predictions(files.get("subtask2.jsonl")!,second,new Map(truth.subtask2.map(r=>[r.id,r])))) {
    const targets = new Map(gold.quadruplets.map(q=>[triple(q),q]));
    const best = new Map<string,number>();
    denominator += row.quadruplets.length + targets.size;
    for (const q of row.quadruplets) {
      const key = triple(q), target = targets.get(key);
      if (target) best.set(key,Math.max(best.get(key) ?? 0,1-distance(q,target)/diameter));
    }
    for (const credit of best.values()) mass += credit;
  }
  const score = 30*(1-Math.sqrt(squared/count)/diameter) + 70*(2*mass/denominator);
  return {score, secondary:0, metric:score, count:truth.subtask1.length+truth.subtask2.length};
}

export async function judgeZip(bytes:Uint8Array, truth:unknown, kind:Kind):Promise<JudgeResult> {
  if (kind === "dim-absa") return judgeNLP(await readZip(bytes,["subtask1.jsonl","subtask2.jsonl"]),truth as NLPTruth);
  const files = await readZip(bytes,["prediction.csv"]);
  const {queries,database} = truth as CVTruth;
  const seen = new Set<string>();
  let hits = 0;
  for (const [q,r] of submissionRows(files.get("prediction.csv")!,["query_id","reference_id"])) {
    if (!Object.hasOwn(queries,q) || seen.has(q)) continue;
    seen.add(q);
    if (Object.hasOwn(database,r) && queries[q][0]===database[r][0] && Math.abs(queries[q][1]-database[r][1])<=10) hits++;
  }
  const count = Object.keys(queries).length;
  const score = 100*hits/count;
  return {score,secondary:0,metric:score,count};
}
