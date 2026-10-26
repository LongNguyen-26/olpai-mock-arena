import { db, key, storage } from "../src/lib/db";
import type { Submission } from "../src/lib/types";
async function main() {
  const namespace = process.env.ARENA_NAMESPACE;
  if (!namespace || !/^arena:qa:[a-zA-Z0-9_-]+$/.test(namespace))
    throw new Error(
      "Explicit QA namespace required; production cleanup refused.",
    );
  let cursor = "0";
  const keys: string[] = [];
  do {
    const page = await db().scan(cursor, { match: key("*"), count: 100 });
    cursor = String(page[0]);
    keys.push(...page[1]);
  } while (cursor !== "0");
  const paths: string[] = [];
  for (const item of keys.filter((k) => k.startsWith(key("submissions:")))) {
    const rows = await db().hgetall<Record<string, Submission>>(item);
    for (const s of Object.values(rows ?? {}))
      if (s.path.startsWith(`submissions/${s.runId}/`)) paths.push(s.path);
  }
  if (paths.length) await storage().del(paths);
  for (let i = 0; i < keys.length; i += 100)
    await db().del(...keys.slice(i, i + 100));
  console.log(
    `Removed ${keys.length} QA keys and ${paths.length} QA CSV objects; production and dataset packages preserved.`,
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
