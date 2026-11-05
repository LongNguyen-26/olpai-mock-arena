export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build" &&
      (process.env.RENDER === "true" || process.env.GROQ_RUNNER_ENABLED === "true")) {
    const { startGroqRunner } = await import("./lib/groq-runner");
    startGroqRunner();
  }
}
