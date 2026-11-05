import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceDeployment } from "../src/lib/workspace-config";

test("Render uses its public URL when no explicit callback origin is configured", () => {
  assert.deepEqual(workspaceDeployment({
    RENDER: "true", RENDER_EXTERNAL_URL: "https://olpai-arena.onrender.com",
  }), {
    controlOrigin: "https://olpai-arena.onrender.com",
    loginOrigins: ["https://olpai-arena.onrender.com"],
  });
});

test("the canonical custom domain overrides Render's generated host and keeps login aliases", () => {
  assert.deepEqual(workspaceDeployment({
    RENDER: "true", RENDER_EXTERNAL_URL: "https://olpai-arena.onrender.com",
    GPU_WORKSPACE_PUBLIC_URL: "https://olpaiarena.cyou/",
    GPU_WORKSPACE_LOGIN_ORIGINS: "https://olpai-arena.onrender.com,https://olpaiarena.cyou",
  }), {
    controlOrigin: "https://olpaiarena.cyou",
    loginOrigins: ["https://olpaiarena.cyou", "https://olpai-arena.onrender.com"],
  });
});

test("explicit configuration remains portable to another host", () => {
  assert.equal(workspaceDeployment({
    GPU_WORKSPACE_PUBLIC_URL: "https://olpai-mock-arena.vercel.app",
  }).controlOrigin, "https://olpai-mock-arena.vercel.app");
});

test("callbacks reject missing, insecure or malformed origins before provisioning", () => {
  for (const value of [undefined, "http://arena.example", "https://user:secret@arena.example", "https://arena.example/path", "https://arena.example?token=secret"]) {
    assert.throws(() => workspaceDeployment({ GPU_WORKSPACE_PUBLIC_URL: value }));
  }
  assert.throws(() => workspaceDeployment({
    GPU_WORKSPACE_PUBLIC_URL: "https://arena.example",
    GPU_WORKSPACE_LOGIN_ORIGINS: "https://alias.example/path",
  }));
});
