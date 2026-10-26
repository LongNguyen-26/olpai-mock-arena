import type { Contest, Phase, Submission } from "./types";
export function phaseOf(c: Contest, now: number): Phase {
  if (c.forcedEndAt !== null && now >= c.forcedEndAt) return "ended";
  if (c.startAt === null) return "waiting";
  if (now < c.startAt) return "scheduled";
  if (now < c.startAt + c.publicSeconds * 1000) return "public";
  if (now < c.startAt + (c.publicSeconds + c.privateSeconds) * 1000)
    return "private";
  return "ended";
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
    ? phase === "private" || phase === "ended"
    : ["public", "private", "ended"].includes(phase);
}
export function visibleSubmission(s: Submission, reveal: boolean) {
  const { path: _path, ...rest } = s;
  return {
    ...rest,
    score: s.split === "private" && !reveal ? null : s.score,
    secondary: s.split === "private" && !reveal ? null : s.secondary,
  };
}
export function rankTeams(
  teams: { id: string; name: string }[],
  submissions: Submission[],
  selections: Record<string, string>,
  split: "public" | "private",
) {
  return teams
    .map((t) => {
      const list = submissions.filter(
        (s) => s.teamId === t.id && s.split === split,
      );
      const chosen = (["1", "2"] as const).map((task) => {
        const candidates = list.filter((s) => s.task === task);
        if (split === "private")
          return (
            candidates.find((s) => s.id === selections[t.id + ":" + task]) ??
            candidates.toSorted((a, b) => b.createdAt - a.createdAt)[0]
          );
        return candidates.toSorted(
          (a, b) => b.score - a.score || a.createdAt - b.createdAt,
        )[0];
      });
      return {
        teamId: t.id,
        name: t.name,
        task1: chosen[0]?.score ?? null,
        task2: chosen[1]?.score ?? null,
        total: ((chosen[0]?.score ?? 0) + (chosen[1]?.score ?? 0)) / 2,
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
