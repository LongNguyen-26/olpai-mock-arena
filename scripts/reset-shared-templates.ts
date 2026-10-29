import { mkdir, writeFile } from "node:fs/promises";
import {
  resetSharedTemplates,
  restoreSharedTemplateBackup,
} from "../src/lib/template-migration";

async function main() {
  const apply = process.argv.includes("--apply"),
    production = (process.env.ARENA_NAMESPACE ?? "arena:v1") === "arena:v1";
  if (apply && production && !process.argv.includes("--production"))
    throw new Error("Production writes require --apply --production.");
  if (process.argv.includes("--restore")) {
    if (!apply)
      throw new Error(
        "Restore requires --apply and a prior inspection of the saved backup.",
      );
    await restoreSharedTemplateBackup();
    console.log("Restored the template backup.");
    return;
  }
  const image =
    process.argv.find((a) => a.startsWith("--image="))?.slice(8) ??
    process.env.RUNPOD_WORKSPACE_IMAGE ??
    "";
  const result = await resetSharedTemplates(image, apply);
  if (result.backup) {
    await mkdir(".local/template-backups", { recursive: true });
    await writeFile(
      `.local/template-backups/${production ? "production" : "qa"}-${Date.now()}.json`,
      JSON.stringify(result.backup, null, 2),
    );
  }
  console.log(
    JSON.stringify({
      applied: result.applied,
      alreadyApplied: result.alreadyApplied,
      backupKey: result.backupKey,
      templates: result.templates.map((t) => ({
        name: t.name,
        gpu: t.gpuTypeId,
        total: t.sessionTokenLimit,
        image: t.imageName,
      })),
    }),
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Migration failed");
  process.exitCode = 1;
});
