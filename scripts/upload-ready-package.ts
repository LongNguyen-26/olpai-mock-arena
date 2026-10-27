import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { resolve, relative, join } from "node:path";
import { storage } from "../src/lib/db";
interface ObjectPlan {
  local: string;
  key: string;
  bytes: number;
  sha256: string;
  contentType: string;
  purpose: string;
}
async function main() {
  const root = resolve(process.argv[2] ?? "../statements/Arena_01/web_ready"),
    plan = JSON.parse(
      await readFile(join(root, "handoff/upload-plan.json"), "utf8"),
    ) as { version: string; objects: ObjectPlan[] };
  await mkdir(".local", { recursive: true });
  const checkpoint = `.local/upload-${plan.version}.json`;
  let done: Record<string, string> = {};
  try {
    done = JSON.parse(await readFile(checkpoint, "utf8"));
  } catch {}
  const files = [];
  for (const object of plan.objects) {
    const file = resolve(root, object.local),
      rel = relative(root, file);
    if (rel.startsWith("..") || rel.includes(":"))
      throw new Error("Object outside web_ready");
    if (
      !object.key.startsWith(`packages/${plan.version}/`) ||
      object.key.split("/").some((p) => p === ".." || p === ".")
    )
      throw new Error("Invalid object key");
    const info = await stat(file);
    if (info.size !== object.bytes)
      throw new Error("Size mismatch: " + object.local);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest("hex") !== object.sha256)
      throw new Error("Checksum mismatch: " + object.local);
    files.push({ object, file });
  }
  console.log(`Verified ${files.length} local object checksums.`);
  const bucket = storage();
  if ((await bucket.publicUrl("check")) !== undefined)
    throw new Error("Private bucket required");
  for (const { object, file } of files) {
    if (
      done[object.key] === object.sha256 &&
      (await bucket.exists(object.key))
    ) {
      console.log("Already uploaded: " + object.local);
      continue;
    }
    console.log("Uploading " + object.local + " (" + object.bytes + " bytes)");
    await bucket.put(
      object.key,
      Readable.toWeb(createReadStream(file)) as ReadableStream,
      {
        size: object.bytes,
        contentType: object.contentType,
        cache: "no-store",
        metadata: { sha256: object.sha256 },
      },
    );
    done[object.key] = object.sha256;
    await writeFile(checkpoint, JSON.stringify(done, null, 2));
    console.log("Uploaded " + object.local);
  }
  const pkg = JSON.parse(
    await readFile(join(root, "handoff/package-config.json"), "utf8"),
  );
  await writeFile(
    ".local/ready-package-config.json",
    JSON.stringify(pkg, null, 2),
  );
  console.log(
    "Upload complete. Local staging manifest prepared; no round changed.",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
