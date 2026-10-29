import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const fixture = JSON.parse(readFileSync(".local/round-access-qa.json", "utf8"));
if (!/^arena:qa:round-access-[\w-]+$/.test(fixture.namespace))
  throw new Error("Round access QA namespace required");
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", "3016"],
  {
    env: { ...process.env, ARENA_NAMESPACE: fixture.namespace },
    stdio: "inherit",
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
