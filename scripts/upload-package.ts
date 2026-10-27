/** Upload only the exact reviewed plan to private Blob; never publishes a round. */
import { readFile } from "node:fs/promises";
import { resolve, dirname, join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { storage } from "../src/lib/db";
import { packageSchema } from "../src/lib/package-schema";

async function main() {
  if (!process.argv[2])
    throw new Error(
      "Usage: tsx --env-file=.env scripts/upload-package.ts path/to/handoff/package-config.json",
    );
  const configPath = resolve(process.argv[2]),
    root = dirname(dirname(configPath));
  const pkg = packageSchema.parse(
    JSON.parse(await readFile(configPath, "utf8")),
  );
  const plan: {
    path: string;
    key: string;
    sha256: string;
    bytes: number;
    contentType: string;
  }[] = JSON.parse(
    await readFile(join(dirname(configPath), "upload-plan.json"), "utf8"),
  );
  const expected = new Set([
    ...pkg.assets.map((a) => a.key),
    ...Object.values(pkg.judges).flatMap((j) =>
      j ? [j.public, j.private] : [],
    ),
  ]);
  assert.equal(plan.length, expected.size);
  assert.equal(new Set(plan.map((p) => p.key)).size, expected.size);
  // Validate every local object before the first remote write.
  for (const row of plan) {
    assert.ok(
      expected.has(row.key) && row.key.startsWith(`packages/${pkg.version}/`),
    );
    const location = resolve(root, row.path),
      rel = relative(root, location);
    assert.ok(!rel.startsWith("..") && !isAbsolute(rel));
    const bytes = await readFile(location);
    assert.equal(bytes.length, row.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256);
  }
  const bucket = storage();
  assert.equal(
    await bucket.publicUrl("visibility-check"),
    undefined,
    "Private bucket required",
  );
  for (const row of plan) {
    if (await bucket.exists(row.key)) {
      const existing = await bucket.get(row.key);
      const bytes = Buffer.from(
        await new Response(existing.body).arrayBuffer(),
      );
      assert.equal(bytes.length, row.bytes);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        row.sha256,
        "Immutable object differs; use a new version",
      );
    } else {
      await bucket.put(
        row.key,
        new Uint8Array(await readFile(resolve(root, row.path))),
        {
          contentType: row.contentType,
          cache: "no-store",
          allowOverwrite: false,
          metadata: { sha256: row.sha256 },
        },
      );
    }
    const info = await bucket.info(row.key);
    assert.equal(info.metadata.sha256, row.sha256);
    console.log(`Verified ${row.path} (${row.bytes} bytes).`);
  }
  console.log(`Uploaded ${pkg.version}. No Redis package or round changed.`);
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
