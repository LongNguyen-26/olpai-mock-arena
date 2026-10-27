import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { db, key, storage, serverNow } from "../src/lib/db";
import type { Contest, ContestPackage, Submission } from "../src/lib/types";
async function main() {
  if (process.env.ARENA_NAMESPACE !== "arena:v1")
    throw new Error("Explicit production namespace required");
  const [roundId, packageId, apply] = process.argv.slice(2);
  if (!roundId || !packageId)
    throw new Error("Usage: refresh-round-package roundId packageId [--apply]");
  const c = await db().get<Contest>(key("round:" + roundId));
  const pkg = await db().get<ContestPackage>(key("package:" + packageId));
  if (!c || !pkg) throw new Error("Round or staged package not found");
  if (c.packageId === packageId)
    throw new Error("Round already uses target package; refusing repeat reset");
  if (c.forcedEndAt === null)
    throw new Error("Finish the old attempt before replacement");
  const records = Object.values(
    (await db().hgetall<Record<string, Submission>>(
      key("submissions:" + c.id),
    )) ?? {},
  );
  for (const s of records)
    if (
      s.runId !== c.id ||
      (!s.path.startsWith(`submissions/${c.id}/`) &&
        !s.path.startsWith(`submissions/arena:v1/${c.id}/`))
    )
      throw new Error("Unexpected submission object path");
  let cursor = "0";
  const related: string[] = [];
  do {
    const page = await db().scan(cursor, { match: key("*"), count: 100 });
    cursor = String(page[0]);
    related.push(
      ...page[1].filter((k) =>
        ["quota:", "request:", "selections:"].some((prefix) =>
          k.startsWith(key(prefix + c.id + ":")),
        ),
      ),
    );
  } while (cursor !== "0");
  const next = {
    ...c,
    id: randomUUID(),
    packageId,
    startAt: null,
    privateAt: null,
    forcedEndAt: null,
    createdAt: await serverNow(),
  };
  console.log(
    JSON.stringify({
      roundId,
      oldRun: c.id,
      packageId,
      submissionsToDelete: records.length,
      relatedKeys: related.length,
      nextState: "waiting",
    }),
  );
  if (apply !== "--apply") return;
  await writeFile(
    ".local/before-standardized-refresh.json",
    JSON.stringify({ contest: c, records }, null, 2),
  );
  const ok = await db().eval<unknown[], number>(
    `local c=redis.call('GET',KEYS[1]);if c~=ARGV[1] then return 0 end;redis.call('SET',KEYS[1],ARGV[2]);return 1`,
    [key("round:" + roundId)],
    [JSON.stringify(c), JSON.stringify(next)],
  );
  if (!ok) throw new Error("Round changed; no results deleted");
  if (records.length) await storage().del(records.map((s) => s.path));
  await db().del(
    key("submissions:" + c.id),
    key("announcements:" + c.id),
    key("runs:" + c.id),
    ...related,
  );
  console.log(
    "Refreshed round; deleted old trial results and quota. Accounts, teams, registrations preserved.",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
