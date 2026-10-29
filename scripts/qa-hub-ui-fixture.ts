import { randomBytes, randomUUID } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { db, key, serverNow } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { encryptSecret } from "../src/lib/workspace-crypto";
import { defaultTemplate, type Workspace } from "../src/lib/workspace-domain";
async function main() {
  const file = ".local/hub-ui.json";
  if (process.argv.includes("--serve") || process.argv.includes("--clean")) {
    const fixture = JSON.parse(await readFile(file, "utf8"));
    assert.ok(fixture.namespace.startsWith("arena:qa:hub-ui:"));
    process.env.ARENA_NAMESPACE = fixture.namespace;
    if (process.argv.includes("--clean")) {
      let cursor = "0";
      do {
        const [next, keys] = await db().scan(cursor, {
          match: fixture.namespace + ":*",
          count: 100,
        });
        cursor = String(next);
        if (keys.length) {
          assert.ok(keys.every((k) => k.startsWith(fixture.namespace + ":")));
          await db().del(...keys);
        }
      } while (cursor !== "0");
      console.log("Removed only Hub UI QA namespace");
    } else {
      const child = spawn(
        process.execPath,
        ["node_modules/next/dist/bin/next", "start", "-p", "3018"],
        {
          env: {
            ...process.env,
            ARENA_NAMESPACE: fixture.namespace,
            GPU_WORKSPACE_ENCRYPTION_KEY: fixture.encryptionKey,
            RUNPOD_HUB_IMAGE: fixture.image,
          },
          stdio: "inherit",
        },
      );
      child.on("exit", (code) => {
        process.exitCode = code ?? 1;
      });
    }
  } else {
    process.env.ARENA_NAMESPACE = `arena:qa:hub-ui:${randomUUID()}`;
    process.env.GPU_WORKSPACE_ENCRYPTION_KEY =
      randomBytes(32).toString("base64");
    const now = await serverNow(),
      password = await hashPassword("Hub-UI-QA-Only-2026!");
    const adminId = randomUUID(),
      users = [adminId, randomUUID(), randomUUID(), randomUUID()];
    const teams = users
      .slice(1)
      .map((id, i) => ({
        id: randomUUID(),
        name: `Team ${String.fromCharCode(65 + i)}`,
        captainId: id,
        members: [id],
        inviteCode: randomUUID(),
        createdAt: now,
      }));
    await db().set(key("admin"), adminId);
    for (const [i, id] of users.entries()) {
      const username = i === 0 ? "qa_hub_admin" : `qa_hub_member${i}`;
      await db().set(key(`user:${id}`), {
        id,
        username,
        password,
        name: username,
        teamId: i ? teams[i - 1].id : null,
        createdAt: now,
      });
      await db().set(key(`username:${username}`), id);
    }
    await db().hset(
      key("teams"),
      Object.fromEntries(teams.map((t) => [t.id, t])),
    );
    const roundId = randomUUID(),
      runId = randomUUID();
    await db().set(key(`round:${roundId}`), {
      id: runId,
      roundId,
      title: "JupyterHub QA",
      startAt: now - 1000,
      forcedEndAt: null,
      publicSeconds: 18000,
      privateSeconds: 3600,
      publicLimit: 20,
      privateLimit: 5,
      createdAt: now,
    });
    await db().zadd(key("rounds"), { score: now, member: roundId });
    await db().hset(
      key(`registrations:${roundId}`),
      Object.fromEntries(
        users
          .slice(1)
          .map((id) => [
            id,
            { userId: id, status: "approved", registeredAt: now },
          ]),
      ),
    );
    const image = "nguyenlong26/olpai-workspace@sha256:" + "f".repeat(64);
    const template = {
      ...defaultTemplate,
      id: randomUUID(),
      imageName: image,
      services: "jupyter" as const,
      jupyterMode: "team-hub" as const,
      maxTeamServers: 7,
      name: "JupyterHub QA",
    };
    await db().hset(key("gpu:templates:shared"), { [template.id]: template });
    const id = randomUUID(),
      manualId = randomUUID();
    const host: Workspace = {
      id,
      teamId: null,
      teamName: "Các team được cấp quyền",
      scope: "all",
      services: "jupyter",
      jupyterMode: "team-hub",
      hubTeams: Object.fromEntries(
        teams
          .slice(0, 2)
          .map((t) => [
            t.id,
            {
              teamId: t.id,
              teamName: t.name,
              enabled: true,
              desiredState: "running" as const,
              revision: randomUUID(),
              updatedAt: now,
            },
          ]),
      ),
      loadDataset: false,
      reservationVersion: 2,
      roundId,
      runId,
      roundTitle: "JupyterHub QA",
      ownerId: adminId,
      podName: "qa-hub-no-real-pod",
      podId: "fakeuihubabc",
      status: "running",
      template,
      secret: encryptSecret("fake-ui-agent"),
      jupyterSecret: encryptSecret("fake-ui-jupyter"),
      createdAt: now,
      updatedAt: now,
      syncedAt: now,
      meterAt: now,
      meterRate: 0.59,
      accruedUsd: 0,
      quotedGpuRate: 0.59,
      health: {
        jupyter: true,
        hubReady: true,
        hubProtocol: 1,
        llm: false,
        publicReady: true,
        privateReady: false,
        stage: "QA",
        gpu: "A40, 8000, 49140, 20, 55",
      },
      error: null,
    };
    await db().set(key(`gpu:workspace:${id}`), host);
    await db().set(key(`gpu:workspace:${manualId}`), {
      ...host,
      id: manualId,
      status: "provisioning",
      podId: null,
      hubTeams: {},
      manual: { state: "prepared" },
      health: null,
      secret: encryptSecret("fake-ui-manual-agent"),
    });
    await db().sadd(key("gpu:workspaces"), id, manualId);
    await db().set(key(`gpu:hub:report:${id}`), {
      runId,
      observedAt: now,
      hubReady: true,
      resources: { availableRAMGiB: 40, freeDiskGiB: 80 },
      notebooks: Object.values(host.hubTeams!).map((t) => ({
        teamId: t.teamId,
        revision: t.revision,
        state: "ready",
        publicReady: true,
        privateReady: false,
      })),
    });
    await writeFile(
      file,
      JSON.stringify({
        namespace: process.env.ARENA_NAMESPACE,
        encryptionKey: process.env.GPU_WORKSPACE_ENCRYPTION_KEY,
        image,
        roundId,
        hostId: id,
        manualId,
      }),
    );
    console.log(
      "Hub UI fixture created in an isolated QA namespace. No Runpod credential or real Pod exists.",
    );
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
