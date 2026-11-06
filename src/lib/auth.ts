import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db, key } from "./db";
import { getAdminIds } from "./admins";
import type { SafeUser, User } from "./types";
import { ApiError } from "./api-error";
import { readUser } from "./entity-repository";
import { usingPostgres } from "./sql";
import { sessionUser, saveSession, removeSession, consumeCounter } from "./sql-runtime";
export { ApiError } from "./api-error";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString("hex")}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const value = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return value.length === expected.length && timingSafeEqual(value, expected);
}
const sessionKey = (token: string) =>
  key(`session:${createHash("sha256").update(token).digest("hex")}`);
export async function getUser(): Promise<SafeUser | null> {
  const token = (await cookies()).get("arena-session")?.value;
  if (!token) return null;
  const id = usingPostgres() ? await sessionUser(createHash("sha256").update(token).digest("hex")) : await db().get<string>(sessionKey(token));
  if (!id) return null;
  const [user, adminIds] = await Promise.all([
    readUser(id),
    getAdminIds(),
  ]);
  if (!user) return null;
  const { password: _password, ...safe } = user;
  return { ...safe, teamId: safe.teamId ?? null, admin: adminIds.includes(id) };
}
export async function createSession(id: string) {
  const token = randomBytes(32).toString("base64url");
  if (usingPostgres()) await saveSession(createHash("sha256").update(token).digest("hex"), id, Date.now() + 7 * 86400_000);
  else await db().set(sessionKey(token), id, { ex: 7 * 86400 });
  (await cookies()).set("arena-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get("arena-session")?.value;
  if (token) {
    if (usingPostgres()) await removeSession(createHash("sha256").update(token).digest("hex"));
    else await db().del(sessionKey(token));
  }
  jar.delete("arena-session");
}
export async function requireUser() {
  const user = await getUser();
  if (!user) throw new ApiError("Vui lòng đăng nhập.", 401);
  return user;
}
export async function requireAdmin() {
  const user = await requireUser();
  if (!user.admin)
    throw new ApiError("Chỉ quản trị viên được thực hiện thao tác này.", 403);
  return user;
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const parsed = new URL(origin ?? "");
    if (
      parsed.origin !== origin ||
      parsed.host !== req.headers.get("host") ||
      !["http:", "https:"].includes(parsed.protocol)
    )
      throw new Error();
  } catch {
    throw new ApiError("Yêu cầu không cùng nguồn.", 403);
  }
}
export async function rateLimit(id: string, limit: number, seconds: number) {
  if (usingPostgres()) {
    if ((await consumeCounter(id, seconds))! > limit) throw new ApiError("Thao tác quá nhanh. Vui lòng thử lại sau.", 429);
    return;
  }
  const result = await db().eval<unknown[], number>(
    `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`,
    [key(`rate:${id}`)],
    [seconds],
  );
  if (result > limit)
    throw new ApiError("Thao tác quá nhanh. Vui lòng thử lại sau.", 429);
}
