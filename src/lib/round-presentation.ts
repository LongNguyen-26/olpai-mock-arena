import {
  contestEnd,
  phaseOf,
  privateStart,
  type ContestTiming,
} from "./domain";

export function roundTiming(c: ContestTiming, now: number) {
  const phase = phaseOf(c, now);
  const end = contestEnd(c);
  const target = phase === "scheduled" ? c.startAt : end;
  const seconds =
    target === null ? null : Math.max(0, Math.ceil((target - now) / 1000));
  return {
    phase,
    seconds: phase === "ended" ? 0 : seconds,
    label:
      phase === "scheduled"
        ? "Bắt đầu sau"
        : phase === "ended"
          ? "Đã kết thúc"
          : "Thời gian còn lại",
    privateAt: privateStart(c),
  };
}
