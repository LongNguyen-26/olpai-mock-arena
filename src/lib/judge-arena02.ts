import { parse } from "csv-parse/sync";
import { SubmissionError } from "./judge";
import type { JudgeResult, JudgeSpec } from "./types";

export const ASPECTS = ["giao_hang", "chat_luong", "gia", "dong_goi", "cskh"];
export const PUMP_LABELS = [
  "binh_thuong",
  "mat_can_bang",
  "lech_truc",
  "hong_vong_bi",
  "xam_thuc",
];
type Truth = { id: string; delivery_minutes?: number; label?: string } & Record<
  string,
  string | number | undefined
>;

// Round the exact binary64 value to two decimal places, ties to even (Python).
export function roundScore(value: number) {
  if (value === 0) return 0;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0),
    exp = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exp ? 1n << 52n : 0n);
  const power = exp ? exp - 1075 : -1074,
    scaled = mantissa * 100n;
  if (power >= 0) return Number(scaled << BigInt(power)) / 100;
  const divisor = 1n << BigInt(-power),
    integer = scaled / divisor,
    remainder = scaled % divisor;
  const roundUp =
    remainder * 2n > divisor ||
    (remainder * 2n === divisor && integer % 2n === 1n);
  return Number(integer + (roundUp ? 1n : 0n)) / 100;
}

function macroF1(gold: string[], pred: string[], labels: string[]) {
  return (
    labels.reduce((sum, label) => {
      let tp = 0,
        fp = 0,
        fn = 0;
      gold.forEach((g, i) => {
        if (g === label && pred[i] === label) tp++;
        else if (pred[i] === label) fp++;
        else if (g === label) fn++;
      });
      return sum + (2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 0);
    }, 0) / labels.length
  );
}

/** The supplied organizer metrics, with strict schema/ID validation added. */
export function judgeArena02(
  csv: string,
  truth: Truth[],
  spec: JudgeSpec,
): JudgeResult {
  const columns =
    spec.kind === "pinball"
      ? ["id", "p50", "p90"]
      : spec.kind === "aspect-f1"
        ? ["id", ...ASPECTS]
        : ["id", "label"];
  let records: string[][];
  try {
    records = parse(csv, {
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
  if (!records.length || records[0].join("\0") !== columns.join("\0"))
    throw new SubmissionError(`CSV phải có đúng cột: ${columns.join(",")}.`);
  if (!truth.length) throw new Error("Empty judge data");
  const known = new Set(truth.map((r) => r.id));
  const predictions = new Map<string, string[]>();
  for (const [id, ...values] of records.slice(1)) {
    if (!known.has(id) || predictions.has(id))
      throw new SubmissionError("ID không tồn tại hoặc bị lặp.");
    if (spec.kind === "pinball") {
      if (
        values.some(
          (v) =>
            !v.trim() ||
            !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()) ||
            !Number.isFinite(Number(v)),
        )
      )
        throw new SubmissionError(
          "p50 và p90 phải là số hữu hạn, không để trống.",
        );
    } else if (spec.kind === "aspect-f1") {
      if (values.some((v) => !["-1", "0", "1"].includes(v)))
        throw new SubmissionError("Mỗi khía cạnh chỉ nhận nhãn -1, 0 hoặc 1.");
    } else if (!PUMP_LABELS.includes(values[0])) {
      throw new SubmissionError(`label phải thuộc: ${PUMP_LABELS.join(", ")}.`);
    }
    predictions.set(id, values);
  }
  if (predictions.size !== truth.length)
    throw new SubmissionError(
      `Thiếu ID: nhận ${predictions.size}/${truth.length} mẫu.`,
    );
  let metric: number;
  if (spec.kind === "pinball") {
    metric =
      truth.reduce((sum, r) => {
        const p = predictions.get(r.id)!;
        return (
          sum +
          [0.5, 0.9].reduce((loss, tau, i) => {
            const d = Number(r.delivery_minutes) - Number(p[i]);
            return loss + Math.max(tau * d, (tau - 1) * d) / 2;
          }, 0)
        );
      }, 0) / truth.length;
  } else if (spec.kind === "aspect-f1") {
    metric =
      ASPECTS.reduce(
        (sum, a, i) =>
          sum +
          macroF1(
            truth.map((r) => String(r[a])),
            truth.map((r) => predictions.get(r.id)![i]),
            ["-1", "0", "1"],
          ),
        0,
      ) / ASPECTS.length;
  } else {
    // sklearn's default macro-F1 averages over the union of observed labels.
    const gold = truth.map((r) => String(r.label)),
      pred = truth.map((r) => predictions.get(r.id)![0]);
    metric = macroF1(gold, pred, [...new Set([...gold, ...pred])]);
  }
  if (!Number.isFinite(metric) || spec.reference === spec.baseline)
    throw new SubmissionError("Dự đoán không thể chấm thành chỉ số hữu hạn.");
  const fraction = Math.max(
    0,
    Math.min(1, (metric - spec.baseline) / (spec.reference - spec.baseline)),
  );
  return {
    score: roundScore(spec.maxScore * fraction),
    secondary: 0,
    metric,
    count: truth.length,
  };
}
