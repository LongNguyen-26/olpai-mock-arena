import { readFile, unlink } from "node:fs/promises";
import { db, key } from "../src/lib/db";
const filename = ".local/round-access-qa.json";
async function main() {
  const fixture = JSON.parse(await readFile(filename, "utf8"));
  if (!/^arena:qa:round-access-[\w-]+$/.test(fixture.namespace)) throw new Error("Round access QA namespace required");
  process.env.ARENA_NAMESPACE = fixture.namespace;
  let cursor = "0";const keys: string[] = [];
  do { const page = await db().scan(cursor, { match: key("*"), count: 100 });cursor = String(page[0]);keys.push(...page[1]); } while (cursor !== "0");
  for (let i = 0; i < keys.length; i += 100) await db().del(...keys.slice(i, i + 100));
  await unlink(filename);
  console.log(`Removed ${keys.length} fixture keys and its local access file. Production was not changed.`);
}
main().catch((error) => { console.error(error.message);process.exitCode = 1; });
