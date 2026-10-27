import type { Contest, Phase, Submission } from "./types";
export function privateStart(c: Contest) {
  return (
    c.privateAt ??
    (c.startAt === null
      ? null
      : c.unlimited
        ? null
        : c.startAt + c.publicSeconds * 1000)
  );
}
export function contestEnd(c: Contest) {
  if (c.forcedEndAt !== null) return c.forcedEndAt;
  const start = privateStart(c);
  return c.unlimited || start === null ? null : start + c.privateSeconds * 1000;
}
export function phaseOf(c: Contest, now: number): Phase {
  if (c.forcedEndAt !== null && now >= c.forcedEndAt) return "ended";
  if (c.startAt === null) return "waiting";
  if (now < c.startAt) return "scheduled";
  const p = privateStart(c),
    end = contestEnd(c);
  if (p === null || now < p) return "public";
  return end === null || now < end ? "private" : "ended";
}
export function canRead(
  c: Contest,
  now: number,
  resource: "statement" | "public" | "private",
  admin = false,
) {
  if (admin) return true;
  const phase = phaseOf(c, now);
  return resource === "private"
    ? ["private", "ended"].includes(phase)
    : ["public", "private", "ended"].includes(phase);
}
export function visibleSubmission(s: Submission, _reveal = true) {
  const { path: _path, ...rest } = s;
  return rest;
}
export function rankTeams(
  teams: { id: string; name: string }[],
  submissions: Submission[],
  _selections: Record<string, string>,
  split: "public" | "private",
) {
  return teams
    .map((t) => {
      const list = submissions.filter(
        (s) => s.teamId === t.id && s.split === split,
      );
      const chosen = (["1", "2"] as const).map(
        (task) =>
          list
            .filter((s) => s.task === task)
            .sort(
              (a, b) =>
                b.score - a.score ||
                (task === "2" ? b.secondary - a.secondary : 0) ||
                a.createdAt - b.createdAt,
            )[0],
      );
      return {
        teamId: t.id,
        name: t.name,
        task1: chosen[0]?.score ?? null,
        task2: chosen[1]?.score ?? null,
        total: (chosen[0]?.score ?? 0) + (chosen[1]?.score ?? 0),
        secondary: chosen[1]?.secondary ?? 0,
        lastAt: Math.max(...chosen.map((s) => s?.createdAt ?? 0)),
        submitted: list.length,
      };
    })
    .filter((t) => t.submitted > 0)
    .sort(
      (a, b) =>
        b.total - a.total || b.secondary - a.secondary || a.lastAt - b.lastAt,
    )
    .map((t, i) => ({ ...t, rank: i + 1 }));
}
