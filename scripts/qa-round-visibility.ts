/** Real HTTP/Redis in the admin UI fixture namespace; no provider calls. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db, key } from "../src/lib/db";
import { SUBMIT_SCRIPT } from "../src/lib/arena";
import type { Contest } from "../src/lib/types";

async function main() {
  const fixture = JSON.parse(
    await readFile(".local/qa-admin-refinements.json", "utf8"),
  );
  assert.ok(fixture.namespace.startsWith("arena:qa:admin-ui:"));
  process.env.ARENA_NAMESPACE = fixture.namespace;
  const base = "http://localhost:3007",
    cookies: string[] = [];
  const request = async (
    route: string,
    cookie: string,
    body?: unknown,
    round = "",
    expected = 200,
  ) => {
    const res = await fetch(
      `${base}/api/${route}${round ? "?round=" + round : ""}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: cookie,
          Origin: base,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    const data = await res.json();
    assert.equal(res.status, expected, JSON.stringify(data));
    return { data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  try {
    const admin = (
      await request("auth/login", "", {
        username: "qa_admin",
        password: fixture.password,
      })
    ).cookie;
    const user = (
      await request("auth/login", "", {
        username: "student@example.edu.vn",
        password: fixture.password,
      })
    ).cookie;
    cookies.push(admin, user);
    const catalogue = (await request("arena", admin)).data;
    const id = catalogue.rounds[0].id;
    const before = (await request("arena", admin, undefined, id)).data;
    await request(
      "admin/control",
      user,
      { action: "visibility", hidden: true },
      id,
      403,
    );
    await request(
      "admin/control",
      admin,
      { action: "visibility", hidden: "yes" },
      id,
      400,
    );
    await request(
      "admin/control",
      admin,
      { action: "visibility", hidden: true },
      id,
    );
    assert.equal((await request("arena", user)).data.rounds.length, 0);
    for (const route of [
      "arena",
      "statement",
      "download",
      "submission/download",
    ])
      await request(route, user, undefined, id, 404);
    await request("round/register", user, {}, id, 404);
    const hidden = (await request("arena", admin, undefined, id)).data;
    assert.equal(hidden.contest.hidden, true);
    assert.equal(hidden.rounds[0].hidden, true);
    assert.deepEqual(hidden.registrations, before.registrations);
    const fakeSubmission = {
      id: randomUUID(),
      status: "accepted",
      adminTest: false,
    };
    const result = await db().eval(
      SUBMIT_SCRIPT,
      [
        key("round:" + id),
        key("visibility-qa-quota"),
        key("visibility-qa-submissions"),
        key("visibility-qa-request"),
        key("user:qa-user"),
        key("registrations:" + id),
        key("admin"),
        key("admins"),
      ],
      [hidden.contest.id, "public", JSON.stringify(fakeSubmission), "qa-team"],
    );
    assert.equal(result, "closed");
    assert.equal(await db().exists(key("visibility-qa-quota")), 0);
    await request(
      "admin/control",
      admin,
      { action: "visibility", hidden: false },
      id,
    );
    const restored = (await request("arena", user, undefined, id)).data;
    assert.equal(restored.registration.status, "approved");
    assert.equal(restored.rounds.length, 1);
    const raw = await db().get<Contest>(key("round:" + id));
    assert.ok(raw);
    await db().set(key("round:" + id), { ...raw, deletedAt: Date.now() });
    assert.equal((await request("arena", admin)).data.rounds.length, 0);
    await request("arena", admin, undefined, id, 404);
    await db().set(key("round:" + id), raw);
    await request("admin/control", admin, { action: "reset" }, id);
    console.log(
      "PASS HTTP: admin-only hide/show, hidden discovery/direct resource/registration denial, atomic in-flight submission denial without quota, preserved enrollment, restored access and deleted-round denial.",
    );
  } finally {
    for (const cookie of cookies) await request("auth/logout", cookie, {});
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
