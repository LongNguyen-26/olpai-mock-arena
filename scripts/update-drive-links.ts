import { db, key } from "../src/lib/db";
import type { ContestPackage } from "../src/lib/types";
import { readFile } from "node:fs/promises";
async function main() {
  const links: Record<string, string> = JSON.parse(
    await readFile(process.argv[2] ?? ".local/drive-links.json", "utf8"),
  );
  for (const url of Object.values(links))
    if (new URL(url).hostname !== "drive.google.com")
      throw new Error("Drive URL required");
  const original = await db().get<ContestPackage>(key("package"));
  if (!original) throw new Error("Original package not found");
  const keys = [key("package"), key(`package:${original.version}`)];
  for (const object of keys) {
    const pkg = await db().get<ContestPackage>(object);
    if (!pkg) continue;
    const updated = {
      ...pkg,
      assets: pkg.assets.map((a) =>
        links[a.name] ? { ...a, driveUrl: links[a.name] } : a,
      ),
    };
    await db().set(object, updated);
  }
  console.log(
    "Verified Drive file links attached to original package; no data or judge objects changed.",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
