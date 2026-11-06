import { ApiError } from "./api-error";

// Runpod (including Jupyter-only/Hub) keeps its existing Redis backend.
// This switch controls availability, not the choice of database for Runpod.
export function runpodMode(): "enabled" | "draining" | "disabled" {
  const value = process.env.ARENA_RUNPOD_MODE ?? "enabled";
  if (value !== "enabled" && value !== "draining" && value !== "disabled")
    throw new Error("Invalid ARENA_RUNPOD_MODE");
  return value;
}
export const runpodAvailable = () => runpodMode() !== "disabled";
export function requireRunpod(newWork = false) {
  const mode = runpodMode();
  if (mode === "disabled" || (newWork && mode === "draining"))
    throw new ApiError("Runpod/Jupyter đang tạm ngừng nhận yêu cầu này.", 503);
}
