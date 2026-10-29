import { z } from "zod";

export const HUB_PROTOCOL = 1;
export const notebookStateSchema = z.enum([
  "stopped",
  "preparing",
  "starting",
  "ready",
  "waiting-resource",
  "error",
]);
export type NotebookState = z.infer<typeof notebookStateSchema>;
export interface TeamNotebook {
  teamId: string;
  teamName: string;
  enabled: boolean;
  desiredState: "running" | "stopped";
  revision: string;
  updatedAt: number;
}
export interface HubNotebookReport {
  teamId: string;
  revision: string;
  state: NotebookState;
  publicReady: boolean;
  privateReady: boolean;
  error?: string;
}
export interface HubReport {
  runId: string;
  observedAt: number;
  hubReady: boolean;
  notebooks: HubNotebookReport[];
  resources: { availableRAMGiB: number | null; freeDiskGiB: number | null };
}
export interface GpuTurn {
  teamId: string;
  teamName: string;
  state: "waiting" | "using";
  requestedAt: number;
  startedAt: number | null;
}
export interface ManualBinding {
  state: "prepared" | "verifying" | "bound" | "detached" | "cancelled";
  candidatePodId?: string;
  boundAt?: number;
}
export const isTeamHub = (w: { jupyterMode?: string }) =>
  w.jupyterMode === "team-hub";
export const hubUsername = (teamId: string) =>
  `t${teamId.replaceAll("-", "").slice(0, 24)}`;
export function hubLoginOrigins(controlUrl: string, extra = "") {
  const origins = [
    new URL(controlUrl).origin,
    ...extra
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ];
  for (const value of origins) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== value)
      throw new Error("Hub login origins must be exact HTTPS origins");
  }
  return [...new Set(origins)];
}
export function hubImage(image: string) {
  return /^nguyenlong26\/olpai-workspace@sha256:[a-f0-9]{64}$/.test(image);
}
export function notebookReport(
  w: { hubTeams?: Record<string, TeamNotebook> },
  report: HubReport | null,
  teamId: string,
  runId: string,
  now: number,
) {
  const team = w.hubTeams?.[teamId];
  if (
    !team ||
    !report ||
    report.runId !== runId ||
    now - report.observedAt > 45000
  )
    return null;
  return (
    report.notebooks.find(
      (n) => n.teamId === teamId && n.revision === team.revision,
    ) ?? null
  );
}
