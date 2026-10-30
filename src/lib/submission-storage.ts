import { gzipSync, gunzipSync } from "node:zlib";
import { BlobError } from "@upstash/blob";
import { db, key, storage } from "./db";
import { ApiError } from "./auth";
import type { Submission } from "./types";

type FileLocation = Pick<Submission, "path" | "fileStorage">;
export async function storeSubmissionFile(
  path: string,
  id: string,
  bytes: Uint8Array,
): Promise<FileLocation> {
  try {
    await storage().put(path, bytes, {
      contentType: "text/csv; charset=utf-8",
      cache: "no-store",
    });
    return { path };
  } catch (error) {
    // Blob may turn read-only at its storage limit. Keep a durable compressed
    // copy outside the history hash, with the same server-side download checks.
    if (!BlobError.is(error)) throw error;
    console.warn("Submission file using Redis fallback", error.code);
    const redisPath = key(`submission-file:${id}`);
    await db().set(redisPath, gzipSync(bytes).toString("base64"));
    return { path: redisPath, fileStorage: "redis" };
  }
}
export async function readSubmissionFile(s: FileLocation) {
  const value = await db().get<string>(s.path);
  if (!value) throw new ApiError("Không tìm thấy tệp bài nộp.", 404);
  return gunzipSync(Buffer.from(value, "base64"), {
    maxOutputLength: 4_000_000,
  });
}
export async function deleteSubmissionFile(s: FileLocation) {
  if (s.fileStorage === "redis") await db().del(s.path);
  else await storage().del(s.path);
}
