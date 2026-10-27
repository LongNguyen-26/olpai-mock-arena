import { readFile, stat, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { db, key, storage } from "../src/lib/db";
import type { ContestPackage, Asset } from "../src/lib/types";
async function main() {
  const root = resolve(process.argv[2] ?? "../statements"),
    out = resolve(".local/judges"),
    version = `mock-2026-v1-${Date.now()}`;
  const python = process.env.ARENA_PYTHON ?? "python";
  await mkdir(out, { recursive: true });
  execFileSync(python, ["scripts/prepare-judges.py", root, out], {
    stdio: "inherit",
  });
  const bucket = storage();
  if ((await bucket.publicUrl("visibility-check")) !== undefined)
    throw new Error("Private bucket required. Import aborted.");
  const judges: ContestPackage["judges"] = {
    "1": { public: "", private: "" },
    "2": { public: "", private: "" },
  };
  for (const task of ["1", "2"] as const)
    for (const split of ["public", "private"] as const) {
      const name = `${task === "1" ? "cv" : "qa"}-${split}.json.gz`,
        objectKey = `packages/${version}/judge/${name}`;
      await bucket.put(
        objectKey,
        new Uint8Array(await readFile(join(out, name))),
        { contentType: "application/gzip", cache: "no-store" },
      );
      judges[task][split] = objectKey;
      console.log(`Uploaded private ${task}/${split} judge.`);
    }
  const assets: Asset[] = [];
  for (const [name, phase, description] of [
    [
      "contestant.zip",
      "public",
      "Train, validation, public input, notebook, baseline và checkpoint gốc. Không chứa nhãn test.",
    ],
    [
      "private_inputs.zip",
      "private",
      "Đầu vào private cho cả hai tác vụ; phát ở giờ cuối. Không chứa nhãn.",
    ],
  ] as const) {
    const file = join(root, name),
      info = await stat(file),
      objectKey = `packages/${version}/assets/${name}`;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    const stream = Readable.toWeb(createReadStream(file));
    await bucket.put(objectKey, stream as ReadableStream, {
      size: info.size,
      contentType: name.endsWith("zip")
        ? "application/zip"
        : name.endsWith("pdf")
          ? "application/pdf"
          : "text/markdown",
      cache: "no-store",
    });
    assets.push({
      key: objectKey,
      name,
      bytes: info.size,
      sha256,
      phase,
      description,
    });
    console.log(`Uploaded ${name} (${info.size} bytes).`);
  }
  const statement = (
    await readFile(join(root, "statement.md"), "utf8")
  ).replace(
    "Đây là công cụ chấm cục bộ, không phải website leaderboard: quota, giờ phát private và lịch sử nộp do người coi thi quản lý theo organizer/README.md.",
    "Khi dùng OlpAI Arena, website tự quản lý giờ phát dữ liệu, quota, lịch sử nộp và bảng điểm. Bộ chấm trên website triển khai cùng định nghĩa metric và schema với bộ chấm cục bộ.",
  );
  const pkg: ContestPackage = {
    version,
    title: process.argv[3] ?? "Bộ đề mới",
    statement,
    assets,
    judges,
    importedAt: Date.now(),
  };
  await db()
    .multi()
    .set(key(`package:${version}`), pkg)
    .hset(key("packages"), { [version]: pkg.title! })
    .exec();
  await writeManifest(assets, version);
  console.log(
    "Package staged for admin confirmation. No new round is published.",
  );
}
async function writeManifest(assets: Asset[], version: string) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    ".local/import-result.json",
    JSON.stringify({ version, assets }, null, 2),
  );
}
main().catch((e) => {
  console.error(
    "Import failed:",
    e instanceof Error ? e.message : "unknown error",
  );
  process.exitCode = 1;
});
