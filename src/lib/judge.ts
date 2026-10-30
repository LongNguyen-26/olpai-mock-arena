import { parse } from "csv-parse/sync";
import type { CVImage, QAItem, JudgeResult } from "./types";
export class SubmissionError extends Error {}
export function submissionRows(csv: string, columns: string[]): string[][] {
  let values: string[][];
  try {
    values = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      max_record_size: 3_000_000,
    });
  } catch {
    throw new SubmissionError(
      "CSV lỗi: kiểm tra dấu ngoặc kép, dấu phẩy và số cột.",
    );
  }
  if (!values.length || values[0].join("\0") !== columns.join("\0"))
    throw new SubmissionError(`CSV phải có đúng cột: ${columns.join(",")}.`);
  if (values.length > 420000) throw new SubmissionError("CSV quá nhiều dòng.");
  return values.slice(1);
}
export function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "")
    .replace(/(?<![\p{L}\p{N}_])(a|an|the)(?![\p{L}\p{N}_])/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function answerScores(prediction: string, answers: { text: string }[]) {
  const golds = answers.map((a) => normalize(a.text)).filter(Boolean);
  if (!golds.length) golds.push("");
  const pred = normalize(prediction);
  let em = 0,
    f1 = 0;
  for (const gold of golds) {
    if (pred === gold) em = 1;
    const p = pred ? pred.split(" ") : [],
      g = gold ? gold.split(" ") : [];
    let score = 0;
    if (!p.length || !g.length) score = Number(pred === gold);
    else {
      const counts = new Map<string, number>();
      for (const t of g) counts.set(t, (counts.get(t) ?? 0) + 1);
      let shared = 0;
      for (const t of p) {
        if ((counts.get(t) ?? 0) > 0) {
          shared++;
          counts.set(t, counts.get(t)! - 1);
        }
      }
      score = (2 * shared) / (p.length + g.length);
    }
    f1 = Math.max(f1, score);
  }
  return { em, f1 };
}
export function judgeQA(csv: string, truth: QAItem[]): JudgeResult {
  const known = new Map(truth.map((q) => [q.id, q]));
  const seen = new Set<string>();
  let f1 = 0,
    em = 0;
  for (const [id, prediction] of submissionRows(csv, ["id", "prediction"])) {
    const q = known.get(id);
    if (!q || seen.has(id))
      throw new SubmissionError("ID không tồn tại hoặc bị lặp.");
    if (prediction && !q.context.includes(prediction))
      throw new SubmissionError(
        `Đáp án của ${id} phải là chuỗi nguyên văn trong context hoặc ô rỗng.`,
      );
    seen.add(id);
    const score = answerScores(prediction, q.answers);
    f1 += score.f1;
    em += score.em;
  }
  if (seen.size !== truth.length)
    throw new SubmissionError(
      `Thiếu ID: nhận ${seen.size}/${truth.length} câu.`,
    );
  return {
    score: (100 * f1) / truth.length,
    secondary: (100 * em) / truth.length,
    count: truth.length,
  };
}
export function parseRuns(text: string, size: number): number[] {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length % 2 || tokens.length > 2_000_000)
    throw new SubmissionError("RLE phải gồm các cặp start length.");
  const intervals: number[] = [];
  let last = 0;
  for (let i = 0; i < tokens.length; i += 2) {
    if (!/^\d+$/.test(tokens[i]) || !/^\d+$/.test(tokens[i + 1]))
      throw new SubmissionError("RLE chỉ nhận số nguyên dương.");
    const start = Number(tokens[i]) - 1,
      length = Number(tokens[i + 1]),
      end = start + length;
    if (
      !Number.isSafeInteger(end) ||
      start < last ||
      start < 0 ||
      length <= 0 ||
      end > size
    )
      throw new SubmissionError(
        "RLE vượt biên, chồng lấn hoặc không tăng dần.",
      );
    intervals.push(start, end);
    last = end;
  }
  return intervals;
}
function area(r: number[]) {
  let sum = 0;
  for (let i = 0; i < r.length; i += 2) sum += r[i + 1] - r[i];
  return sum;
}
function intersection(a: number[], b: number[]) {
  let i = 0,
    j = 0,
    n = 0;
  while (i < a.length && j < b.length) {
    n += Math.max(0, Math.min(a[i + 1], b[j + 1]) - Math.max(a[i], b[j]));
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return n;
}
export function imageAP(gold: number[][], pred: number[][]) {
  if (!gold.length || !pred.length) return Number(gold.length === pred.length);
  const ga = gold.map(area),
    pa = pred.map(area);
  const edges = gold.map((g, i) =>
    pred.flatMap((p, j) => {
      const common = intersection(g, p),
        iou = common / (ga[i] + pa[j] - common);
      return iou > 0.5 ? [{ j, iou }] : [];
    }),
  );
  // At IoU > 0.5 and disjoint masks, each object can match at most one object.
  let total = 0;
  for (let t = 50; t < 100; t += 5) {
    let tp = 0;
    for (const row of edges)
      for (const edge of row) if (edge.iou > t / 100) tp++;
    total += tp / (gold.length + pred.length - tp);
  }
  return total / 10;
}
export function judgeCV(csv: string, truth: CVImage[]): JudgeResult {
  const known = new Map(truth.map((q) => [q.id, q]));
  const predictions = new Map<string, number[][]>();
  const allRuns = new Map<string, number[]>();
  for (const [id, value] of submissionRows(csv, ["ImageId", "EncodedPixels"])) {
    const q = known.get(id);
    if (!q)
      throw new SubmissionError("ImageId không tồn tại trong tập đang nộp.");
    const text = value.trim(),
      previous = predictions.get(id);
    if (previous && (!previous.length || !text))
      throw new SubmissionError(
        "Dòng ảnh rỗng phải là dòng duy nhất của ảnh đó.",
      );
    if (!text) {
      predictions.set(id, []);
      continue;
    }
    const masks = previous ?? [];
    if (masks.length >= 4096)
      throw new SubmissionError("Tối đa 4096 cá thể mỗi ảnh.");
    const run = parseRuns(text, q.width * q.height);
    masks.push(run);
    predictions.set(id, masks);
    const runs = allRuns.get(id) ?? [];
    for (const x of run) runs.push(x);
    allRuns.set(id, runs);
  }
  if (predictions.size !== truth.length)
    throw new SubmissionError(
      `Thiếu ImageId: nhận ${predictions.size}/${truth.length} ảnh.`,
    );
  for (const runs of allRuns.values()) {
    const intervals = [];
    for (let i = 0; i < runs.length; i += 2)
      intervals.push([runs[i], runs[i + 1]]);
    intervals.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < intervals.length; i++)
      if (intervals[i][0] < intervals[i - 1][1])
        throw new SubmissionError("Các mask cá thể không được chồng lấn.");
  }
  const score =
    (100 *
      truth.reduce(
        (sum, q) => sum + imageAP(q.masks, predictions.get(q.id)!),
        0,
      )) /
    truth.length;
  return { score, secondary: 0, count: truth.length };
}
