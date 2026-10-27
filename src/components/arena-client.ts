import type { snapshot } from "@/lib/rounds";
export type ArenaData = Awaited<ReturnType<typeof snapshot>>;
export type Action = (
  route: string,
  value: unknown,
  message?: string,
  target?: string,
) => Promise<void>;
export type ViewProps = { data: ArenaData; busy: boolean; action: Action };
export const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toFixed(2);
export const when = (n: number) =>
  new Date(n).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
export const bytes = (n: number) =>
  n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1000).toFixed(1)} KB`;
export const duration = (n: number) =>
  `${Math.floor(n / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((n % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
export const endpoint = (route: string, round = "") =>
  `/api/${route}${round ? `?round=${encodeURIComponent(round)}` : ""}`;
export async function api(route: string, value?: unknown, round = "") {
  const res = await fetch(
    endpoint(route, round),
    value === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Không thể thực hiện yêu cầu.");
  return data;
}
