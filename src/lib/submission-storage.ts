import { gzipSync, gunzipSync } from "node:zlib";
import { BlobError } from "@upstash/blob";
import { db, key, storage } from "./db";
import { ApiError } from "./auth";
import type { Submission } from "./types";
import { usingPostgres, query, namespace } from "./sql";

type FileLocation = Pick<Submission, "path" | "fileStorage">;
export async function storeSubmissionFile(
  path: string,
  id: string,
  bytes: Uint8Array,
): Promise<FileLocation> {
  try {
    await storage().put(path, bytes, {
      contentType: path.endsWith(".zip") ? "application/zip" : "text/csv; charset=utf-8",
      cache: "no-store",
    });
    return { path };
  } catch (error) {
    // Blob may turn read-only at its storage limit. Keep a durable compressed
    // copy outside the history hash, with the same server-side download checks.
    if (!BlobError.is(error)) throw error;
    if (usingPostgres()) {
      await saveSqlSubmissionFile(id, bytes);
      console.warn("Submission file using SQL fallback", error.code);
      return { path: id, fileStorage: "postgres" };
    }
    console.warn("Submission file using Redis fallback", error.code);
    const redisPath = key(`submission-file:${id}`);
    await db().set(redisPath, gzipSync(bytes).toString("base64"));
    return { path: redisPath, fileStorage: "redis" };
  }
}
export async function readSubmissionFile(s: FileLocation) {
  if (s.fileStorage === "postgres") {
    const row = (await query("select gzip from arena.submission_files where ns=$1 and id=$2", [namespace(), s.path]))[0];
    if (!row) throw new ApiError("Không tìm thấy tệp bài nộp.", 404);
    return gunzipSync(row.gzip, { maxOutputLength: 4_000_000 });
  }
  const value = await db().get<string>(s.path);
  if (!value) throw new ApiError("Không tìm thấy tệp bài nộp.", 404);
  return gunzipSync(Buffer.from(value, "base64"), {
    maxOutputLength: 4_000_000,
  });
}
export async function deleteSubmissionFile(s: FileLocation) {
  if (s.fileStorage === "postgres") await query("delete from arena.submission_files where ns=$1 and id=$2", [namespace(), s.path]);
  else if (s.fileStorage === "redis") await db().del(s.path);
  else await storage().del(s.path);
}
export async function saveSqlSubmissionFile(id: string, bytes: Uint8Array) {
  if (bytes.byteLength > 4_000_000) throw new ApiError("Tệp bài nộp vượt giới hạn.", 413);
  await query("insert into arena.submission_files(ns,id,gzip) values($1,$2,$3) on conflict(ns,id) do nothing", [namespace(), id, gzipSync(bytes)]);
}
