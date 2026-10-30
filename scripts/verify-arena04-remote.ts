import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { db, key, storage } from "../src/lib/db";
import { packageSchema } from "../src/lib/package-schema";
import type { Contest, ContestPackage } from "../src/lib/types";
const root = resolve("../statements/Arena_04/web_ready/release_20261030");
const checkpoint = ".local/arena04-rounds-before-stage.json";
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
async function main() {
  const pkg = packageSchema.parse(JSON.parse(await readFile(root + "/handoff/package-config.json", "utf8")));
  assert.equal(process.env.ARENA_NAMESPACE ?? "arena:v1", "arena:v1");
  const ids = await db().zrange<string[]>(key("rounds"), 0, -1);
  const hashes: Record<string, string> = {};
  for (const id of ids) hashes[id] = digest(await db().get<Contest>(key(`round:${id}`)));
  if (process.argv[2] === "before") {
    assert.equal(await db().exists(key(`package:${pkg.version}`)), 0);
    const plan = JSON.parse(await readFile(root + "/handoff/upload-plan.json", "utf8"));
    const bucket = storage(); assert.equal(await bucket.publicUrl("visibility-check"), undefined);
    const objects = [];
    for (const row of plan.objects) {
      assert.ok(row.key.startsWith(`packages/${pkg.version}/`));
      const bytes = Buffer.from(await new Response((await bucket.get(row.key)).body).arrayBuffer());
      assert.equal(bytes.length, row.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256);
      if (row.local.endsWith(".zip")) {
        const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        assert.ok(eocd > 0);
        const count = bytes.readUInt16LE(eocd + 10);
        let offset = bytes.readUInt32LE(eocd + 16);
        const names = [];
        for (let i = 0; i < count; i++) {
          assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
          const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
          names.push(bytes.subarray(offset + 46, offset + 46 + length).toString("utf8"));
          offset += 46 + length + extra + comment;
        }
        assert.ok(names.every((name) => !/\.py$|\.json$/i.test(name)));
        if (!row.local.includes("_private")) assert.equal(names.filter((name) => name.endsWith("/baseline.ipynb")).length, 1);
        objects.push({ path: row.local, bytes: bytes.length, sha256: row.sha256, members: names });
      } else objects.push({ path: row.local, bytes: bytes.length, sha256: row.sha256 });
    }
    await writeFile(checkpoint, JSON.stringify({ version: pkg.version, rounds: hashes }, null, 2));
    await writeFile(root + "/internal/qa/remote-object-checksums.json", JSON.stringify({ version: pkg.version, privateBucket: true, objects, baselineFiles: 2 }, null, 2));
    console.log(`Verified all ${objects.length} remote objects and ZIP member lists; two baseline notebooks included in public ZIPs.`);
  } else {
    const before = JSON.parse(await readFile(checkpoint, "utf8"));
    assert.equal(before.version, pkg.version);
    assert.deepEqual(hashes, before.rounds, "Staging must not create or change a round");
    const actual = await db().get<ContestPackage>(key(`package:${pkg.version}`));
    assert.ok(actual);
    const parsed = packageSchema.parse(actual);
    assert.deepEqual(parsed, pkg);
    assert.equal(await db().hget(key("packages"), pkg.version), pkg.title);
    await writeFile(root + "/internal/qa/production-catalog.json", JSON.stringify({ version: pkg.version, title: pkg.title, staged: true, roundCount: ids.length, existingRoundsUnchanged: true, newRoundPublished: false, baselineFiles: 2 }, null, 2));
    console.log("Catalogue verified: Arena 04 present; all existing rounds unchanged; no new round published.");
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
