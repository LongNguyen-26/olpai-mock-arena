type RunnerState = { startedAt: number; lastPollAt: number | null; lastSuccessfulPollAt: number | null };
const host = globalThis as typeof globalThis & { arenaGroqRunner?: RunnerState };
export const groqRunnerState = () => host.arenaGroqRunner ?? null;
export function initializeGroqRunner() {
  if (host.arenaGroqRunner) return false;
  host.arenaGroqRunner = { startedAt: Date.now(), lastPollAt: null, lastSuccessfulPollAt: null };
  return true;
}
