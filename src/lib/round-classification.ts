export const roundCategoryIds = ["mock", "topic", "selection"] as const;
export type RoundCategory = typeof roundCategoryIds[number];
export const roundSubcategoryIds = ["general", "regional", "national", "nlp", "vision", "ml", "school", "team", "other"] as const;
export type RoundSubcategory = typeof roundSubcategoryIds[number];
export type RoundClassification = { category: RoundCategory; subcategory: RoundSubcategory };
export const roundCategories = [
  { id: "mock", title: "Thi thử Olympic AI", short: "Thi thử", description: "Các vòng mô phỏng kỳ thi Olympic AI, từ vòng miền đến vòng quốc gia.", subcategories: ["general", "regional", "national"] },
  { id: "topic", title: "Luyện tập chuyên đề", short: "Chuyên đề", description: "Rèn luyện theo lĩnh vực hoặc dạng bài, từ xử lý ngôn ngữ đến thị giác máy tính.", subcategories: ["general", "nlp", "vision", "ml"] },
  { id: "selection", title: "Thi tuyển chọn", short: "Tuyển chọn", description: "Các vòng tuyển đội, thi nội bộ và đánh giá năng lực thành viên.", subcategories: ["other", "school", "team"] },
] as const;
export const roundSubcategoryNames: Record<RoundSubcategory, string> = {
  general: "Tổng hợp", regional: "Vòng miền", national: "Vòng quốc gia", nlp: "Xử lý ngôn ngữ (NLP)",
  vision: "Thị giác máy tính (CV)", ml: "Machine Learning", school: "Cấp trường", team: "Nội bộ đội", other: "Khác",
};
export function defaultRoundSubcategory(category: RoundCategory): RoundSubcategory { return category === "selection" ? "other" : "general"; }
export function validRoundClassification(value: RoundClassification) {
  return (roundCategories.find(c => c.id === value.category)?.subcategories as readonly string[] | undefined)?.includes(value.subcategory) ?? false;
}
export function roundClassification(round: { title: string; category?: RoundCategory; subcategory?: RoundSubcategory }): RoundClassification {
  // Explicitly requested placement for the existing, unclassified Regional round.
  const category = roundCategoryIds.includes(round.category!) ? round.category! : /\bregional\b/i.test(round.title) ? "topic" : "mock";
  const value = { category, subcategory: round.subcategory ?? defaultRoundSubcategory(category) };
  return validRoundClassification(value) ? value : { category, subcategory: defaultRoundSubcategory(category) };
}
export type RoundActivity = { createdAt?: number; publishedAt?: number; catalogActivityAt?: number; startAt?: number | null; practice?: { startAt: number } };
export function roundActivityAt(round: RoundActivity, now: number) {
  const events = [round.publishedAt ?? round.createdAt, round.catalogActivityAt, round.startAt, round.practice?.startAt];
  return Math.max(0, ...events.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= now));
}
export function recentRounds<T extends RoundActivity>(rounds: readonly T[], now: number) {
  // Stable ties retain the administrator's catalogue order.
  return [...rounds].sort((a,b) => roundActivityAt(b,now) - roundActivityAt(a,now));
}
