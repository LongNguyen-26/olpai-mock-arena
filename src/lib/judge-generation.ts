import { parseRuns, submissionRows, SubmissionError } from "./judge";
import type { JudgeResult } from "./types";

export interface TrimapTruth {
  width: number;
  height: number;
  items: { id: string; pet: string; border: string }[];
}
export interface GenerationTruth {
  items: { id: string; references: string[] }[];
}

function mask(pet: string, border: string, size: number) {
  const result = new Uint8Array(size);
  for (const [label, text] of [[1, pet], [2, border]] as const) {
    if (!text.trim()) continue;
    const runs = parseRuns(text, size);
    for (let i = 0; i < runs.length; i += 2) {
      for (let j = runs[i]; j < runs[i + 1]; j++) {
        if (result[j]) throw new SubmissionError("Vùng thú cưng và vùng biên không được chồng lấn.");
        result[j] = label;
      }
    }
  }
  return result;
}

export function judgeTrimap(csv: string, truth: TrimapTruth): JudgeResult {
  const known = new Map(truth.items.map((x) => [x.id, x]));
  const seen = new Set<string>();
  const intersection = [0, 0, 0], union = [0, 0, 0];
  for (const [id, pet, border] of submissionRows(csv, ["id", "pet_rle", "border_rle"])) {
    const item = known.get(id);
    if (!item || seen.has(id)) throw new SubmissionError("ID không tồn tại hoặc bị lặp.");
    const size = truth.width * truth.height;
    const pred = mask(pet, border, size), gold = mask(item.pet, item.border, size);
    for (let i = 0; i < size; i++) {
      if (pred[i] === gold[i]) { intersection[pred[i]]++; union[pred[i]]++; }
      else { union[pred[i]]++; union[gold[i]]++; }
    }
    seen.add(id);
  }
  if (seen.size !== truth.items.length) throw new SubmissionError(`Thiếu ID: nhận ${seen.size}/${truth.items.length} ảnh.`);
  const iou = intersection.map((x, k) => union[k] ? x / union[k] : 1);
  return { score: 100 * iou.reduce((a, b) => a + b, 0) / 3, secondary: 100 * iou[2], metric: iou.reduce((a, b) => a + b, 0) / 3, count: seen.size };
}

// Arena 04: arithmetic mean of best-reference sentence chrF2, not corpus chrF.
function chars(text: string) {
  return Array.from(text.normalize("NFKC").toLowerCase().replace(/\p{White_Space}/gu, ""));
}
function grams(text: string[], n: number) {
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= text.length; i++) {
    const key = text.slice(i, i + n).join(""); counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
export function sentenceChrf2(prediction: string, reference: string): number {
  const p = chars(prediction), r = chars(reference);
  if (!p.length || !r.length) return Number(p.length === r.length);
  let precision = 0, recall = 0, orders = 0;
  for (let n = 1; n <= 6; n++) {
    if (p.length < n || r.length < n) continue;
    const pg = grams(p, n), rg = grams(r, n);
    let matched = 0;
    for (const [g, count] of pg) matched += Math.min(count, rg.get(g) ?? 0);
    precision += matched / (p.length - n + 1);
    recall += matched / (r.length - n + 1);
    orders++;
  }
  precision /= orders; recall /= orders;
  return precision + recall ? 5 * precision * recall / (4 * precision + recall) : 0;
}
export function judgeGeneration(csv: string, truth: GenerationTruth): JudgeResult {
  const known = new Map(truth.items.map((x) => [x.id, x]));
  const seen = new Set<string>();
  let total = 0, exact = 0;
  for (const [id, prediction] of submissionRows(csv, ["id", "prediction"])) {
    const item = known.get(id);
    if (!item || seen.has(id)) throw new SubmissionError("ID không tồn tại hoặc bị lặp.");
    if (Array.from(prediction).length > 1000) throw new SubmissionError("Mỗi mô tả tối đa 1000 ký tự Unicode.");
    total += Math.max(...item.references.map((r) => sentenceChrf2(prediction, r)));
    if (item.references.some((r) => chars(r).join("") === chars(prediction).join(""))) exact++;
    seen.add(id);
  }
  if (seen.size !== truth.items.length) throw new SubmissionError(`Thiếu ID: nhận ${seen.size}/${truth.items.length} bản ghi.`);
  return { score: 100 * total / seen.size, secondary: 100 * exact / seen.size, metric: total / seen.size, count: seen.size };
}
