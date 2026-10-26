import { Redis } from "@upstash/redis";
import { Bucket } from "@upstash/blob";
export const key = (suffix: string) =>
  `${process.env.ARENA_NAMESPACE ?? "arena:v1"}:${suffix}`;
export function db() {
  return Redis.fromEnv();
}
export function storage() {
  return Bucket.fromEnv();
}
export async function serverNow() {
  const [seconds, micros] = await db().time();
  return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
}
