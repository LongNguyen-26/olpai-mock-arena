import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db, key } from "./db";
import type { SafeUser, User } from "./types";
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
  const id = await db().get<string>(sessionKey(token));
  if (!id) return null;
  const [user, adminId] = await Promise.all([
    db().get<User>(key(`user:${id}`)),
    db().get<string>(key("admin")),
  ]);
  if (!user) return null;
  const { password: _password, ...safe } = user;
  return { ...safe, admin: id === adminId };
}
export async function createSession(id: string) {
  const token = randomBytes(32).toString("base64url");
  await db().set(sessionKey(token), id, { ex: 7 * 86400 });
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
  if (token) await db().del(sessionKey(token));
  jar.delete("arena-session");
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
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
  const result = await db().eval<unknown[], number>(
    `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`,
    [key(`rate:${id}`)],
    [seconds],
  );
  if (result > limit)
    throw new ApiError("Thao tác quá nhanh. Vui lòng thử lại sau.", 429);
}
