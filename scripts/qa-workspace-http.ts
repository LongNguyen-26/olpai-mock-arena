/** Run against the localhost server started with .local/gpu-qa.json's isolated namespace. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db, key, serverNow } from "../src/lib/db";
import type { Contest } from "../src/lib/types";

async function main() {
  const fixture = JSON.parse(await readFile(".local/gpu-qa.json", "utf8"));
  assert.ok(fixture.namespace.startsWith("arena:qa:gpu:"));
  process.env.ARENA_NAMESPACE = fixture.namespace;
  const origin = "http://localhost:3010";
  async function call(
    path: string,
    cookie = "",
    value?: unknown,
    extra: Record<string, string> = {},
  ) {
    return fetch(origin + "/api/" + path, {
      method: value === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
        ...extra,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      redirect: "manual",
    });
  }
  async function login(username: string) {
    const response = await call("auth/login", "", {
      username,
      password: fixture.password,
    });
    assert.equal(response.status, 200);
    return response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }
  assert.equal((await call("workspace/state")).status, 401);
  const admin = await login(fixture.admin),
    member = await login(fixture.member);
  const state = await (await call("workspace/state", admin)).json();
  assert.ok(state.hasCredential);
  assert.ok(state.workspaces.length >= 1);
  for (const w of state.workspaces) {
    assert.equal("secret" in w, false);
    assert.equal("jupyterSecret" in w, false);
    assert.equal("ownerId" in w, false);
  }
  assert.equal((await call("workspace/template", member, {})).status, 403);
  assert.equal(
    (await call("workspace/deploy", admin, {}, { Origin: "https://evil.test" }))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        `workspace/manifest?id=${fixture.workspaceId}`,
        "",
        undefined,
        { Authorization: "Bearer wrong" },
      )
    ).status,
    401,
  );
  const outsider = await call("auth/register", "", {
    username: `outsider_${randomUUID().slice(0, 8)}`,
    name: "Đội khác QA",
    password: fixture.password,
  });
  assert.equal(outsider.status, 200);
  const outsiderCookie = outsider.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.equal(
    (await call(`workspace/chat?id=${fixture.workspaceId}`, outsiderCookie))
      .status,
    403,
  );
  assert.equal(
    (await (await call("workspace/state", outsiderCookie)).json()).workspaces
      .length,
    0,
  );
  const launch = await call(
    `workspace/launch?id=${fixture.workspaceId}`,
    member,
  );
  assert.equal(launch.status, 307);
  assert.ok(
    new URL(launch.headers.get("location")!).hostname.endsWith(
      ".proxy.runpod.net",
    ),
  );
  const c = await db().get<Contest>(key(`round:${fixture.roundId}`));
  assert.ok(c);
  try {
    await db().set(key(`round:${fixture.roundId}`), {
      ...c,
      privateAt: await serverNow(),
    });
    const chat = await (
      await call(`workspace/chat?id=${fixture.workspaceId}`, member)
    ).json();
    assert.equal(chat.enabled, false);
    const blocked = await call("workspace/chat", member, {
      id: fixture.workspaceId,
      session: randomUUID(),
      requestId: randomUUID(),
      content: "Chặn trước khi gọi model",
    });
    assert.equal(blocked.status, 403);
  } finally {
    await db().set(key(`round:${fixture.roundId}`), c);
  }
  console.log(
    "PASS HTTP: login/session, 401, admin 403, Origin 403, cross-team isolation, private agent auth, secret-free DTO, notebook redirect, private chatbot lock. No real Runpod call.",
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "HTTP QA failed");
  process.exitCode = 1;
});
