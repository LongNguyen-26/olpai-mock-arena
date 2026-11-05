import type { TaskId } from "./types";

export interface PackageSummary {
  id: string;
  title: string;
  importedAt: number;
  arenaNumber?: number;
  edition?: "original" | "standardized";
  tasks: { id: TaskId; title: string }[];
}

const dateFormat = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit",
  year: "numeric", hour: "2-digit", minute: "2-digit",
});

function identity(p: PackageSummary) {
  const number = p.arenaNumber ?? Number(
    p.id.match(/arena[-_ ]*0*(\d+)/i)?.[1] ??
    p.title.match(/(?:arena|bộ đề)[-_ ]*0*(\d+)/i)?.[1] ??
    (p.id.startsWith("mock-2026-v1-") ? "1" : "0"),
  );
  return number > 0 ? `Bộ đề Arena ${String(number).padStart(2, "0")}` : p.title;
}

/** Labels are derived from the catalogue; immutable package IDs and round bindings stay stable. */
export function presentPackages(packages: PackageSummary[]) {
  const groups = new Map<string, PackageSummary[]>();
  for (const p of packages) {
    const name = identity(p);
    groups.set(name, [...(groups.get(name) ?? []), p]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "vi", { numeric: true }))
    .flatMap(([name, rows]) => {
      const ordered = [...rows].sort((a, b) => a.importedAt - b.importedAt || a.id.localeCompare(b.id));
      const standardized = ordered.filter(p => p.edition === "standardized" ||
        (p.edition !== "original" && /standardized|chuẩn hóa/i.test(`${p.id} ${p.title}`)));
      const latest = standardized.at(-1);
      return ordered.map(p => {
        const index = standardized.findIndex(s => s.id === p.id);
        const date = Number.isFinite(p.importedAt) && p.importedAt > 0
          ? dateFormat.format(p.importedAt) : "chưa rõ ngày nạp";
        const version = p.id === latest?.id ? `Bản hiện hành (${date})`
          : index >= 0 ? `Chuẩn hóa cũ v${index + 1} (${date})` : "Bản cũ";
        return { id: p.id, title: `${name} · ${version}`, current: p.id === latest?.id };
      }).sort((a, b) => Number(b.current) - Number(a.current));
    });
}
