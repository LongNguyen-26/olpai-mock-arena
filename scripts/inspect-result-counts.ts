import { db, key } from "../src/lib/db";
import type { Submission, Contest } from "../src/lib/types";
async function main() {
  if (process.env.ARENA_NAMESPACE !== "arena:v1")
    throw new Error("Explicit production namespace required");
  let cursor = "0";
  const keys: string[] = [];
  do {
    const page = await db().scan(cursor, { match: key("*"), count: 100 });
    cursor = String(page[0]);
    keys.push(...page[1]);
  } while (cursor !== "0");
  for (const k of keys.filter((k) => k.startsWith(key("submissions:")))) {
    const rows = Object.values(
      (await db().hgetall<Record<string, Submission>>(k)) ?? {},
    );
    console.log(
      JSON.stringify({ key: k, count: rows.length, runId: rows[0]?.runId }),
    );
  }
  for (const id of await db().zrange<string[]>(key("rounds"), 0, -1)) {
    const c = await db().get<Contest>(key("round:" + id));
    console.log(
      JSON.stringify({ roundId: id, runId: c?.id, packageId: c?.packageId }),
    );
  }
  console.log(
    JSON.stringify({
      archives: keys.filter((k) => k.startsWith(key("runs:"))).length,
    }),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
