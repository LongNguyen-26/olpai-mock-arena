/** Real HTTP/Redis in the qa-workspace-flow --keep namespace. No provider mutations. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db, key, serverNow } from "../src/lib/db";
import type { Workspace, WorkspaceTemplate } from "../src/lib/workspace-domain";
async function main() {
  const fixture = JSON.parse(await readFile(".local/gpu-qa.json", "utf8"));
  assert.match(fixture.namespace, /^arena:qa:gpu:/);
  process.env.ARENA_NAMESPACE = fixture.namespace;
  const base = "http://localhost:3010",
    cookies: string[] = [];
  async function request(path: string, cookie = "", body?: unknown) {
    const r = await fetch(base + "/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: base,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  async function login(username: string) {
    const r = await request("auth/login", "", {
      username,
      password: fixture.password,
    });
    assert.equal(r.status, 200);
    cookies.push(r.cookie);
    return r.cookie;
  }
  let original: WorkspaceTemplate | undefined,
    current: WorkspaceTemplate | undefined;
  let admin = "";
  try {
    admin = await login(fixture.admin);
    const member = await login(fixture.member);
    assert.equal(
      (
        await request("workspace/metrics", member, {
          id: fixture.workspaceId,
          visible: false,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("workspace/metrics", admin, {
          id: fixture.workspaceId,
          visible: "false",
        })
      ).status,
      400,
    );
    const state = (await request("workspace/state", admin)).data;
    original = state.templates.find(
      (t: WorkspaceTemplate) => t.id === "00000000-0000-4000-8000-000000000040",
    );
    assert.ok(original);
    assert.equal(
      (await request("workspace/template", admin, original)).status,
      409,
    );
    assert.equal(
      (
        await request("workspace/template", admin, {
          ...original,
          id: randomUUID(),
          name: " " + original.name.toUpperCase() + " ",
        })
      ).status,
      409,
    );
    const updated = await request("workspace/template", admin, {
      ...original,
      tokenLimitMode: "turn",
      inputTokenLimit: 96,
      outputTokenLimit: 160,
      overwrite: true,
      expectedRevision: original.revision ?? "legacy",
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    current = updated.data;
    assert.equal(
      (
        await request("workspace/template", admin, {
          ...current,
          overwrite: true,
          expectedRevision: original.revision ?? "legacy",
        })
      ).status,
      409,
    );
    const wk = key(`gpu:workspace:${fixture.workspaceId}`),
      w = await db().get<Workspace>(wk);
    assert.ok(w);
    await db().set(wk, { ...w, syncedAt: await serverNow() });
    const chat = (
      await request(
        `workspace/chat?id=${fixture.workspaceId}&session=${randomUUID()}`,
        member,
      )
    ).data;
    assert.equal(chat.template.tokenLimitMode, "turn");
    assert.equal(chat.template.inputTokenLimit, 96);
    assert.equal(chat.template.outputTokenLimit, 160);
    assert.equal(
      (
        await request("workspace/metrics", admin, {
          id: fixture.workspaceId,
          visible: false,
        })
      ).status,
      200,
    );
    const hidden = (
      await request("workspace/state", member)
    ).data.workspaces.find((w: Workspace) => w.id === fixture.workspaceId);
    assert.equal(hidden.health?.gpu, undefined);
    assert.equal(hidden.uptimeSeconds, undefined);
    assert.equal(hidden.metricsVisible, false);
    const hiddenSync = (
      await request("workspace/sync", member, { id: fixture.workspaceId })
    ).data;
    assert.equal(hiddenSync.health?.gpu, undefined);
    assert.ok(
      (await request("workspace/state", admin)).data.workspaces.find(
        (w: Workspace) => w.id === fixture.workspaceId,
      ).health.gpu,
    );
    await request("workspace/metrics", admin, {
      id: fixture.workspaceId,
      visible: true,
    });
    await db().set(wk, {
      ...(await db().get<Workspace>(wk)),
      status: "stopped",
    });
    assert.equal(
      (
        await request("workspace/metrics", admin, {
          id: fixture.workspaceId,
          visible: false,
        })
      ).status,
      409,
    );
    await db().set(wk, { ...w, syncedAt: await serverNow() });
    const name = "Concurrent HTTP " + randomUUID().slice(0, 8);
    const writes = await Promise.all(
      [0, 1].map(() =>
        request("workspace/template", admin, {
          ...original,
          id: randomUUID(),
          name,
          tokenLimitMode: "session",
        }),
      ),
    );
    assert.equal(writes.filter((r) => r.status === 200).length, 1);
    assert.ok(writes.every((r) => [200, 409].includes(r.status)));
    console.log(
      "PASS HTTP/Redis: template confirmation/revision/duplicate/concurrent names, live chat policy, admin-only metrics, state+sync redaction, running-only toggle. No real Pod or model called.",
    );
  } finally {
    if (original && current)
      await request("workspace/template", admin, {
        ...original,
        overwrite: true,
        expectedRevision: current.revision,
      });
    for (const cookie of cookies) await request("auth/logout", cookie, {});
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
