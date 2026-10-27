import { db, key, serverNow } from "../src/lib/db";
import type { Contest, ContestPackage } from "../src/lib/types";
async function main() {
  const c = await db().get<Contest>(key("contest")),
    pkg = await db().get<ContestPackage>(key("package"));
  if (!c || !pkg) throw new Error("Existing contest/package required.");
  const id = c.roundId ?? c.id,
    packageId = pkg.version;
  const migrated: Contest = {
    ...c,
    roundId: id,
    packageId,
    privateAt: null,
    unlimited: false,
    autoApprove: true,
  };
  const result = await db().eval<unknown[], number>(
    `if redis.call('EXISTS',KEYS[1])==1 then return 0 end;redis.call('SET',KEYS[1],ARGV[1]);redis.call('SET',KEYS[2],ARGV[2]);redis.call('HSET',KEYS[3],ARGV[3],ARGV[4]);redis.call('ZADD',KEYS[4],ARGV[5],ARGV[6]);return 1`,
    [
      key(`round:${id}`),
      key(`package:${packageId}`),
      key("packages"),
      key("rounds"),
    ],
    [
      JSON.stringify(migrated),
      JSON.stringify({ ...pkg, title: "Bộ đề 01" }),
      packageId,
      "Bộ đề 01",
      await serverNow(),
      id,
    ],
  );
  console.log(
    result
      ? "Migrated existing package and round; accounts/submissions preserved."
      : "Round migration already applied; preserved existing configuration.",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
