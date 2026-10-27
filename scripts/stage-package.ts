import { readFile } from "node:fs/promises";
import { z } from "zod";
import { db, key, storage } from "../src/lib/db";
const taskId = z.enum(["1", "2"]);
const objectKey = z
  .string()
  .min(1)
  .refine(
    (s) =>
      s.startsWith("packages/") &&
      !s.split("/").some((p) => p === ".." || p === "."),
    "Package object key required",
  );
const pair = z.object({ public: objectKey, private: objectKey });
const schema = z.object({
  version: z.string().min(1).max(100),
  title: z.string().min(3).max(100),
  statement: z.string().default(""),
  tasks: z
    .array(
      z.object({
        id: taskId,
        title: z.string().min(1),
        content: z.string().min(1),
      }),
    )
    .length(2),
  assets: z.array(
    z.object({
      key: objectKey,
      name: z.string().min(1),
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      phase: z.enum(["public", "private"]),
      description: z.string().default(""),
      driveUrl: z
        .string()
        .url()
        .refine((s) => new URL(s).hostname === "drive.google.com")
        .optional(),
      task: taskId.optional(),
    }),
  ),
  judges: z.object({ "1": pair, "2": pair }),
});
async function main() {
  if (!process.argv[2])
    throw new Error(
      "Usage: tsx --env-file=.env scripts/stage-package.ts path/to/package.json",
    );
  const pkg = schema.parse(JSON.parse(await readFile(process.argv[2], "utf8")));
  if (new Set(pkg.tasks.map((t) => t.id)).size !== 2)
    throw new Error("Both task IDs required.");
  if (await db().exists(key(`package:${pkg.version}`)))
    throw new Error("Version already exists. Use a new immutable version.");
  const bucket = storage();
  if ((await bucket.publicUrl("check")) !== undefined)
    throw new Error("A private bucket is required.");
  for (const object of [
    ...pkg.assets.map((a) => a.key),
    ...Object.values(pkg.judges).flatMap((j) => [j.public, j.private]),
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
