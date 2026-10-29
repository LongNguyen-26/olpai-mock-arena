/** Configure only the shared Hub template after deployment. Never calls Pod APIs. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hubImage } from "../src/lib/hub-domain";
import {
  defaultTemplate,
  type WorkspaceTemplate,
} from "../src/lib/workspace-domain";

async function main() {
  const image = process.argv.find((v) => v.startsWith("--image="))?.slice(8);
  assert.ok(
    image && hubImage(image),
    "Provide --image=<published immutable Hub digest>",
  );
  const base = "https://olpai-mock-arena.vercel.app";
  const name = "JupyterHub · 7 team · GPU dùng chung";
  if (!process.argv.includes("--apply")) {
    console.log(
      JSON.stringify({ target: base, templateName: name, image, apply: false }),
    );
    return;
  }
  const access = await readFile("ACCESS.local.md", "utf8");
  const password = access.match(/Mật khẩu ban đầu: (.+)/)?.[1];
  assert.ok(password, "Missing local admin access file");
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "arena_admin", password }),
  });
  assert.equal(login.status, 200, "Admin login failed");
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  async function call(path: "state" | "template", value?: unknown) {
    const response = await fetch(base + "/api/workspace/" + path, {
      method: value ? "POST" : "GET",
      headers: {
        Cookie: cookie!,
        Origin: base,
        "Content-Type": "application/json",
      },
      ...(value ? { body: JSON.stringify(value) } : {}),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Release configuration failed");
    return result;
  }
  try {
    const state = await call("state");
    const existing = (state.templates as WorkspaceTemplate[]).find(
      (t) => t.name === name,
    );
    if (existing)
      assert.equal(
        existing.jupyterMode,
        "team-hub",
        "Refusing to overwrite an unrelated template",
      );
    const template: WorkspaceTemplate = {
      ...defaultTemplate,
      ...(existing ?? {}),
      id: existing?.id ?? randomUUID(),
      name,
      imageName: image,
      services: "jupyter",
      jupyterMode: "team-hub",
      maxTeamServers: existing?.maxTeamServers ?? 7,
      minRAMPerGPU: existing?.minRAMPerGPU ?? 50,
      minVCPUPerGPU: existing?.minVCPUPerGPU ?? 9,
    };
    const saved = await call("template", {
      ...template,
      overwrite: !!existing,
      expectedRevision: existing ? (existing.revision ?? "legacy") : undefined,
    });
    assert.equal(
      saved.jupyterMode,
      "team-hub",
      "The deployed web does not support Hub templates",
    );
    assert.equal(saved.imageName, image);
    console.log(
      JSON.stringify({
        templateId: saved.id,
        templateName: saved.name,
        image: saved.imageName,
        podActions: 0,
      }),
    );
  } finally {
    await fetch(base + "/api/auth/logout", {
      method: "POST",
      headers: { Origin: base, Cookie: cookie },
    });
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Release configuration failed",
  );
  process.exitCode = 1;
});
