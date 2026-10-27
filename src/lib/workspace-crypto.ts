import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
function encryptionKey() {
  const value = Buffer.from(
    process.env.GPU_WORKSPACE_ENCRYPTION_KEY ?? "",
    "base64",
  );
  if (value.length !== 32)
    throw new Error(
      "Cần GPU_WORKSPACE_ENCRYPTION_KEY là khóa base64 32 byte trên server.",
    );
  return value;
}
export function encryptSecret(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function decryptSecret(value: string) {
  const [iv, tag, body] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    "utf8",
  );
}
export function matchesSecret(header: string | null, value: string) {
  const a = Buffer.from(header ?? ""),
    b = Buffer.from(`Bearer ${value}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
