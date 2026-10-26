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
  const initial = await db().get<{ id: string; startAt: number | null }>(
    key("contest"),
  );
  if (!initial || initial.startAt !== null)
    throw new Error("Import only into an initialized, unscheduled contest.");
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
    [
      "Bo_de_mo_phong_OlpAI_2026.pdf",
      "public",
      "Bộ đề mô phỏng đầy đủ, định dạng PDF để đọc offline.",
    ],
    [
      "ATTRIBUTION.md",
      "public",
      "Nguồn dữ liệu, giấy phép và ghi công của bộ luyện.",
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
    statement,
    assets,
    judges,
    importedAt: Date.now(),
  };
  const c = await db().get<{ startAt: number | null }>(key("contest"));
  if (c?.startAt !== null && c)
    throw new Error(
      "Do not replace judge package after scheduling or starting a contest.",
    );
  const activated = await db().eval<unknown[], number>(
    `local c=cjson.decode(redis.call('GET',KEYS[1]));if c.id~=ARGV[1] or c.startAt~=cjson.null then return 0 end;redis.call('SET',KEYS[2],ARGV[2]);return 1`,
    [key("contest"), key("package")],
    [initial.id, JSON.stringify(pkg)],
  );
  if (!activated)
    throw new Error("Contest changed during import; package not activated.");
  await writeManifest(assets, version);
  console.log("Package activated. All answer keys remain in private storage.");
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
