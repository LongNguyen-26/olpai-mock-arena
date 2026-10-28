/** Privileged provisioning only. Passwords go to a new ignored local file. */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { z } from "zod";
import { db, key, serverNow } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import type { User } from "../src/lib/types";

async function main() {
  const username = z
    .string()
    .regex(/^[a-z0-9_]{3,40}$/)
    .parse(process.argv[2]);
  const name = z.string().trim().min(2).max(60).parse(process.argv[3]);
  const output = resolve(process.argv[4] ?? ".local/ADMIN_2_ACCESS.local.md");
  const rel = relative(resolve(".local"), output);
  if (
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    resolve(output) === resolve(".local")
  )
    throw new Error("Credentials must be saved inside .local/.");
  if (
    (process.env.ARENA_NAMESPACE ?? "arena:v1") === "arena:v1" &&
    !process.argv.includes("--production")
  )
    throw new Error(
      "Use --production for the explicitly authorized account creation.",
    );
  const primary = await db().get<string>(key("admin"));
  if (!primary)
    throw new Error(
      "Original administrator is missing; initialize it separately.",
    );
  if (await db().exists(key(`username:${username}`)))
    throw new Error(
      "Username already exists; no account or password was changed.",
    );
  const password = "OlpAI!" + randomBytes(24).toString("base64url");
  const user: User = {
    id: randomUUID(),
    username,
    name,
    password: await hashPassword(password),
    teamId: null,
    createdAt: await serverNow(),
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `# Tài khoản quản trị bổ sung\n\n- Tên đăng nhập: ${username}\n- Mật khẩu: ${password}\n- Tên hiển thị: ${name}\n- Đăng nhập: https://olpai-mock-arena.vercel.app/login\n\nĐổi mật khẩu tại Tài khoản sau khi đăng nhập.\n`,
    { flag: "wx", mode: 0o600 },
  );
  // Retain the credential file if a network error leaves the write outcome uncertain.
  const result = await db().eval<unknown[], number>(
    `if redis.call('GET',KEYS[1])~=ARGV[1] then return -1 end;if redis.call('EXISTS',KEYS[2])==1 or redis.call('EXISTS',KEYS[3])==1 then return 0 end;redis.call('SET',KEYS[2],ARGV[2]);redis.call('SET',KEYS[3],ARGV[3]);redis.call('SADD',KEYS[4],ARGV[2]);return 1`,
    [
      key("admin"),
      key(`username:${username}`),
      key(`user:${user.id}`),
      key("admins"),
    ],
    [primary, user.id, JSON.stringify(user)],
  );
  if (result !== 1) {
    await unlink(output);
    throw new Error(
      "Account creation conflicted; no existing account was replaced.",
    );
  }
  if ((await db().get(key("admin"))) !== primary)
    throw new Error(
      "Primary administrator changed concurrently; inspect before proceeding.",
    );
  console.log(
    JSON.stringify({
      created: true,
      username,
      credentialsFile: relative(process.cwd(), output),
      originalAdminPreserved: true,
    }),
  );
}
main().catch((error) => {
  console.error(
    error instanceof z.ZodError
      ? "Invalid provisioning arguments."
      : error.message,
  );
  process.exitCode = 1;
});
