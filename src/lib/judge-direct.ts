import { submissionRows, SubmissionError } from "./judge";
import type { DirectJudgeSpec, JudgeResult } from "./types";
import { judgeTrimap, judgeGeneration, type TrimapTruth, type GenerationTruth } from "./judge-generation";

export interface ForecastTruth {
  horizon: number;
  scales: Record<string, number>;
  items: { id: string; series_id: string; value: number }[];
}
export interface MultilabelTruth {
  labelCount: number;
  items: { id: string; labels: number[] }[];
}

export function judgeScaledMAE(csv: string, truth: ForecastTruth): JudgeResult {
  const known = new Map(truth.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let error = 0;
  for (const [id, value] of submissionRows(csv, ["id", "prediction"])) {
    const item = known.get(id);
    if (!item || seen.has(id))
      throw new SubmissionError("ID không tồn tại hoặc bị lặp.");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
      throw new SubmissionError("prediction phải là số thực hữu hạn, không âm.");
    const prediction = Number(value);
    if (!Number.isFinite(prediction) || prediction < 0)
      throw new SubmissionError("prediction phải là số thực hữu hạn, không âm.");
    seen.add(id);
    error += (Math.abs(prediction - item.value) / truth.scales[item.series_id]) / truth.items.length;
  }
  if (seen.size !== truth.items.length)
    throw new SubmissionError(`Thiếu ID: nhận ${seen.size}/${truth.items.length} giá trị.`);
  // Every series has the same 168 targets, so the row mean is the series mean.
  const mase = error;
  return { score: 100 / (1 + mase), secondary: 0, metric: mase, count: seen.size };
}

export function judgeMultilabel(csv: string, truth: MultilabelTruth): JudgeResult {
  const known = new Map(truth.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const tp = Array<number>(truth.labelCount).fill(0);
  const fp = Array<number>(truth.labelCount).fill(0);
  const fn = Array<number>(truth.labelCount).fill(0);
  let exact = 0;
  for (const [id, value] of submissionRows(csv, ["id", "labels"])) {
    const item = known.get(id);
    if (!item || seen.has(id))
      throw new SubmissionError("ID không tồn tại hoặc bị lặp.");
    if (!/^(?:0|[1-9]\d*)(?: (?:0|[1-9]\d*))*$/.test(value))
      throw new SubmissionError("labels phải là các ID nhãn tăng dần, cách nhau một dấu cách.");
    const labels = value.split(" ").map(Number);
    if (
      labels.length > truth.labelCount ||
      labels.some((label, i) => !Number.isSafeInteger(label) || label >= truth.labelCount || (i > 0 && label <= labels[i - 1]))
    )
      throw new SubmissionError(`ID nhãn phải khác nhau, tăng dần và từ 0 đến ${truth.labelCount - 1}.`);
    const pred = new Set(labels), gold = new Set(item.labels);
    if (pred.size === gold.size && labels.every((label) => gold.has(label))) exact++;
    for (let k = 0; k < truth.labelCount; k++) {
      if (pred.has(k) && gold.has(k)) tp[k]++;
      else if (pred.has(k)) fp[k]++;
      else if (gold.has(k)) fn[k]++;
    }
    seen.add(id);
  }
  if (seen.size !== truth.items.length)
    throw new SubmissionError(`Thiếu ID: nhận ${seen.size}/${truth.items.length} văn bản.`);
  const macro = tp.reduce((sum, n, k) => {
    const denominator = 2 * n + fp[k] + fn[k];
    return sum + (denominator ? 2 * n / denominator : 0);
  }, 0) / truth.labelCount;
  return { score: 100 * macro, secondary: 100 * exact / seen.size, metric: macro, count: seen.size };
}

export function judgeDirect(csv: string, truth: unknown, spec: DirectJudgeSpec): JudgeResult {
  if (spec.kind === "trimap-iou") return judgeTrimap(csv, truth as TrimapTruth);
  if (spec.kind === "generation-chrf") return judgeGeneration(csv, truth as GenerationTruth);
  return spec.kind === "scaled-mae"
    ? judgeScaledMAE(csv, truth as ForecastTruth)
    : judgeMultilabel(csv, truth as MultilabelTruth);
}
