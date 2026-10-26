import { randomUUID } from "node:crypto";
import { db, key } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import type { ContestPackage, Contest, User } from "../src/lib/types";
async function main() {
  if (!process.env.ARENA_NAMESPACE?.startsWith("arena:qa:"))
    throw new Error("QA namespace required");
  const pkg = await db().get<ContestPackage>("arena:v1:package");
  if (!pkg) throw new Error("Import production package first");
  await db().set(key("package"), pkg);
  const id = randomUUID();
  const admin: User = {
    id,
    username: "qa_admin",
    name: "Quản trị QA",
    password: await hashPassword("Arena-QA-Only-2026!"),
    teamId: null,
    createdAt: Date.now(),
  };
  await db().set(key(`user:${id}`), admin);
  await db().set(key("username:qa_admin"), id);
  await db().set(key("admin"), id);
  const c: Contest = {
    id: randomUUID(),
    title: "OlpAI 2026 · Buổi kiểm tra hệ thống",
    startAt: null,
    forcedEndAt: null,
    publicSeconds: 18000,
    privateSeconds: 3600,
    publicLimit: 20,
    privateLimit: 5,
    createdAt: Date.now(),
  };
  await db().set(key("contest"), c);
  console.log("Isolated QA namespace ready; production contest unchanged.");
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
