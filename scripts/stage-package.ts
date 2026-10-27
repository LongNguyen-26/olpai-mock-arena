import { readFile } from "node:fs/promises";
import { z } from "zod";
import { db, key, storage } from "../src/lib/db";
import { packageSchema as schema } from "../src/lib/package-schema";
async function main() {
  if (!process.argv[2])
    throw new Error(
      "Usage: tsx --env-file=.env scripts/stage-package.ts path/to/package.json",
    );
  const pkg = schema.parse(JSON.parse(await readFile(process.argv[2], "utf8")));
  if (await db().exists(key(`package:${pkg.version}`)))
    throw new Error("Version already exists. Use a new immutable version.");
  const bucket = storage();
  if ((await bucket.publicUrl("check")) !== undefined)
    throw new Error("A private bucket is required.");
  for (const object of [
    ...pkg.assets.map((a) => a.key),
    ...Object.values(pkg.judges).flatMap((j) =>
      j ? [j.public, j.private] : [],
    ),
  ])
    await bucket.info(object);
  await db()
    .multi()
    .set(key(`package:${pkg.version}`), { ...pkg, importedAt: Date.now() })
    .hset(key("packages"), { [pkg.version]: pkg.title })
    .exec();
  console.log(
    "Package staged. Admin must confirm publication in the website before contestants can register.",
  );
}
main().catch((e) => {
  console.error(
    e instanceof z.ZodError
      ? e.issues.map((i) => i.path.join(".") + ": " + i.message).join("\n")
      : e.message,
  );
  process.exitCode = 1;
});
