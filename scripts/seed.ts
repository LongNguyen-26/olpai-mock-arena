import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { db, key } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import type { Contest, User } from "../src/lib/types";
async function main() {
  const redis = db();
  await redis.ping();
  if (!(await redis.get(key("admin")))) {
    const password = randomBytes(18).toString("base64url"),
      id = randomUUID();
    const user: User = {
      id,
      username: "arena_admin",
      name: "Quản trị Arena",
      password: await hashPassword(password),
      teamId: null,
      createdAt: Date.now(),
    };
    const created = await redis.eval<unknown[], number>(
      `if redis.call('EXISTS',KEYS[1])==1 or redis.call('EXISTS',KEYS[2])==1 then return 0 end;redis.call('SET',KEYS[1],ARGV[1]);redis.call('SET',KEYS[2],ARGV[1]);redis.call('SET',KEYS[3],ARGV[2]);return 1`,
      [key("admin"), key("username:arena_admin"), key(`user:${id}`)],
      [id, JSON.stringify(user)],
    );
    if (!created)
      throw new Error(
        "Admin or reserved username already exists; no accounts changed.",
      );
    await writeFile(
      "ACCESS.local.md",
      `# Truy cập quản trị OlpAI Arena\n\nURL: https://olpai-mock-arena.vercel.app\n\nTên đăng nhập: arena_admin\n\nMật khẩu ban đầu: ${password}\n\nĐổi mật khẩu trong mục Tài khoản ngay sau lần đăng nhập đầu. Tệp này không được đưa lên Git.\n`,
    );
    console.log(
      "Admin created. Initial access is in ignored ACCESS.local.md (password not printed).",
    );
  } else console.log("Existing admin preserved.");
  const contest: Contest = {
    id: randomUUID(),
    title: "OlpAI 2026 · Vòng luyện số 01",
    startAt: null,
    forcedEndAt: null,
    publicSeconds: 18000,
    privateSeconds: 3600,
    publicLimit: 20,
    privateLimit: 5,
    createdAt: Date.now(),
  };
  const created = await redis.set(key("contest"), contest, { nx: true });
  console.log(
    created
      ? "Contest created in waiting state (5h + 1h)."
      : "Existing contest preserved.",
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Seed failed");
  process.exitCode = 1;
});
