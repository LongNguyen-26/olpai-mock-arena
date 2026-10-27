/** Real Redis in a fresh QA namespace, stubbed Runpod/Pod HTTP. Never deploys a GPU. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db, key, serverNow } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import {
  accessWorkspace,
  agentManifest,
  controlWorkspace,
  deployWorkspace,
  getWorkspace,
  gpuPrices,
  launchNotebook,
  readChat,
  saveCredential,
  saveTemplate,
  sendChat,
  syncWorkspace,
  workspaceState,
} from "../src/lib/workspaces";
import { defaultTemplate } from "../src/lib/workspace-domain";
import { decryptSecret } from "../src/lib/workspace-crypto";
import type {
  Contest,
  ContestPackage,
  SafeUser,
  Team,
  User,
} from "../src/lib/types";
import type { RunpodPod } from "../src/lib/runpod";

async function main() {
  process.env.ARENA_NAMESPACE = `arena:qa:gpu:${randomUUID()}`;
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.GPU_WORKSPACE_PUBLIC_URL = "https://qa.example.test";
  const originalFetch = globalThis.fetch;
  let creates = 0,
    generations = 0,
    mode: "ok" | "timeout" | "reject" = "ok";
  const pods: RunpodPod[] = [];
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.runpod.io/v2/catalog/gpus")
      return json({
        gpus: [
          {
            id: "NVIDIA A40",
            name: "A40",
            memory: 48,
            price: { community: 0.59, secure: 0.7 },
          },
        ],
      });
    if (url === "https://api.runpod.io/graphql") {
      const request = JSON.parse(init?.body as string);
      const input = request.variables?.input;
      if (request.query.includes("ArenaCreate")) {
        creates++;
        if (mode === "reject")
          return json({
            data: { podFindAndDeployOnDemand: null },
            errors: [
              {
                message: "No instances available",
                extensions: { code: "SUPPLY_CONSTRAINT" },
              },
            ],
          });
        const pod = {
          id: `qapod${creates}abc`,
          name: input.name,
          desiredStatus: "RUNNING",
          costPerHr: 0.604,
        };
        pods.push(pod);
        if (mode === "timeout")
          throw new Error("Simulated lost create response");
        return json({ data: { podFindAndDeployOnDemand: pod } });
      }
      if (request.query.includes("ArenaPods"))
        return json({ data: { myself: { pods } } });
      const pod = pods.find((p) => p.id === input.podId);
      if (!pod) return json({}, 404);
      if (request.query.includes("ArenaTerminate")) {
        pods.splice(pods.indexOf(pod), 1);
        return json({ data: { podTerminate: null } });
      }
      if (request.query.includes("ArenaStop")) {
        pod.desiredStatus = "EXITED";
        return json({ data: { podStop: pod } });
      }
      if (request.query.includes("ArenaResume")) {
        pod.desiredStatus = "RUNNING";
        return json({ data: { podResume: pod } });
      }
      return json(pod);
    }
    if (url.includes(".proxy.runpod.net")) {
      if (url.endsWith("/api/status")) return json({ status: "ok" });
      if (url.endsWith("/health"))
        return json({
          jupyter: true,
          llm: true,
          publicReady: true,
          privateReady: false,
          stage: "QA fixture",
          gpu: "A40, 21000 MiB, 49140 MiB, 0 %",
        });
      if (url.endsWith("/token-count")) return json({ count: 20 });
      if (url.endsWith("/generate")) {
        generations++;
        return json({
          content: "Phản hồi QA từ runtime giả lập.",
          inputTokens: 20,
          outputTokens: 10,
        });
      }
      throw new Error("Unexpected runtime path");
    }
    return originalFetch(input, init);
  };
  const now = await serverNow(),
    admin: SafeUser = {
      id: randomUUID(),
      username: "qa_gpu_admin",
      name: "Quản trị GPU QA",
      createdAt: now,
      teamId: null,
      admin: true,
    };
  const team: Team = {
    id: randomUUID(),
    name: "Đội GPU QA",
    captainId: randomUUID(),
    members: [],
    inviteCode: "QA-GPU-ONLY",
    createdAt: now,
  };
  const member: SafeUser = {
    id: team.captainId,
    username: "qa_gpu_member",
    name: "Thí sinh GPU QA",
    createdAt: now,
    teamId: team.id,
    admin: false,
  };
  team.members = [member.id];
  const other: SafeUser = { ...member, id: randomUUID(), teamId: randomUUID() };
  const c: Contest = {
    id: randomUUID(),
    roundId: randomUUID(),
    packageId: "gpu-qa-package",
    title: "Bộ đề GPU QA",
    startAt: now - 1000,
    forcedEndAt: null,
    publicSeconds: 18000,
    privateSeconds: 3600,
    publicLimit: 20,
    privateLimit: 5,
    createdAt: now,
  };
  const t = {
    ...defaultTemplate,
    imageName: "nguyenlong26/olpai-workspace:2026.10.27",
  };
  const pkg = {
    version: c.packageId,
    statement: "",
    tasks: [
      {
        id: "1",
        title: "Tách từng nhân tế bào",
        content:
          "# Tác vụ 1 Tách từng nhân tế bào\n\n## 1 Bài toán\n\nNội dung QA.",
      },
      { id: "2", title: "Đọc hiểu", content: "# Tác vụ 2 Đọc hiểu" },
    ],
    assets: [
      {
        key: "qa-public",
        workspaceLayout: "task-root",
        name: "public.zip",
        bytes: 10,
        sha256: "a".repeat(64),
        phase: "public",
        description: "QA",
        driveUrl: "https://drive.google.com/file/d/public123456789/view",
      },
      {
        key: "qa-private",
        name: "private.zip",
        bytes: 10,
        sha256: "b".repeat(64),
        phase: "private",
        description: "QA",
        driveUrl: "https://drive.google.com/file/d/private123456789/view",
      },
    ],
    judges: {},
    importedAt: now,
  } as ContestPackage;
  try {
    for (const user of [admin, member]) {
      const { admin: _a, ...safe } = user;
      const stored: User = {
        ...safe,
        password: await hashPassword("Arena-GPU-QA-Only-2026!"),
      };
      await db().set(key(`user:${user.id}`), stored);
      await db().set(key(`username:${user.username}`), user.id);
    }
    await db().set(key("admin"), admin.id);
    await db().hset(key("teams"), { [team.id]: team });
    await db().set(key(`round:${c.roundId}`), c);
    await db().set(key(`package:${c.packageId}`), pkg);
    await db().zadd(key("rounds"), { score: now, member: c.roundId! });
    await db().hset(key(`registrations:${c.roundId}`), {
      [member.id]: { userId: member.id, status: "approved", registeredAt: now },
    });
    await saveCredential(admin, "qa-fake-runpod-key-no-real-account");
    assert.ok(
      !(await db().get<string>(key(`gpu:credential:${admin.id}`)))!.includes(
        "qa-fake",
      ),
    );
    await saveTemplate(t);
    await gpuPrices(admin);
    const concurrent = await Promise.allSettled([
      deployWorkspace(admin, team.id, c.roundId!, t.id, 0.75),
      deployWorkspace(admin, team.id, c.roundId!, t.id, 0.75),
    ]);
    assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(creates, 1);
    const w = (
      concurrent.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<Awaited<ReturnType<typeof deployWorkspace>>>
    ).value;
    await assert.rejects(() => accessWorkspace(other, w.id), /không thuộc/);
    await syncWorkspace(member, w.id);
    const stored = await getWorkspace(w.id);
    const manifest = await agentManifest(
      w.id,
      `Bearer ${decryptSecret(stored.secret)}`,
    );
    assert.equal(manifest.assets.length, 1);
    assert.ok(!JSON.stringify(manifest).includes("private123456789"));
    await assert.rejects(() => agentManifest(w.id, "Bearer wrong"));
    assert.ok(
      (await launchNotebook(member, w.id)).startsWith(
        "https://qapod1abc-8888.proxy.runpod.net/lab?token=",
      ),
    );
    const requestId = randomUUID(),
      session = randomUUID();
    const answer = await sendChat(
      member,
      w.id,
      session,
      requestId,
      "Hướng dẫn baseline",
    );
    assert.equal(answer.session.inputTokens, 20);
    assert.equal(answer.session.outputTokens, 10);
    await sendChat(member, w.id, session, requestId, "retry cùng requestId");
    assert.equal(generations, 1);
    assert.equal(
      (await readChat(member, w.id, session)).session.messages.length,
      2,
    );
    const safe = await workspaceState(member);
    assert.ok(!JSON.stringify(safe).includes(stored.secret));
    assert.equal(safe.teams.length, 0);
    await db().set(key(`gpu:workspace:${w.id}`), {
      ...(await getWorkspace(w.id)),
      health: null,
      syncedAt: 0,
    });
    assert.equal((await readChat(member, w.id, session)).enabled, true);
    c.privateAt = await serverNow();
    await db().set(key(`round:${c.roundId}`), c);
    assert.equal(
      (await agentManifest(w.id, `Bearer ${decryptSecret(stored.secret)}`))
        .assets.length,
      2,
    );
    await assert.rejects(
      () =>
        sendChat(member, w.id, randomUUID(), randomUUID(), "private request"),
      /giai đoạn public/,
    );
    const oldRun = c.id;
    c.id = randomUUID();
    await db().set(key(`round:${c.roundId}`), c);
    assert.equal(
      (await agentManifest(w.id, `Bearer ${decryptSecret(stored.secret)}`))
        .active,
      true,
    );
    assert.equal(
      (await readChat(member, w.id, session)).session.messages.length,
      0,
    );
    await syncWorkspace(admin, w.id);
    assert.ok(
      (await launchNotebook(member, w.id)).includes("8888.proxy.runpod.net"),
    );
    c.id = oldRun;
    c.privateAt = null;
    await db().set(key(`round:${c.roundId}`), c);
    await controlWorkspace(admin, w.id, "stop");
    await controlWorkspace(admin, w.id, "start");
    await controlWorkspace(admin, w.id, "terminate");
    mode = "timeout";
    const uncertain = await deployWorkspace(
      admin,
      team.id,
      c.roundId!,
      t.id,
      0.75,
    );
    assert.equal(uncertain.status, "reconciling");
    assert.equal(uncertain.meterRate, 0);
    assert.equal(uncertain.estimatedUsd, 0);
    await assert.rejects(
      () => deployWorkspace(admin, team.id, c.roundId!, t.id, 0.75),
      /đã có Pod/,
    );
    assert.equal(creates, 2);
    const reconciled = await syncWorkspace(admin, uncertain.id);
    assert.equal(reconciled.podId, "qapod2abc");
    assert.equal(creates, 2);
    await controlWorkspace(admin, uncertain.id, "terminate");
    mode = "reject";
    const rejected = await deployWorkspace(
      admin,
      team.id,
      c.roundId!,
      t.id,
      0.75,
    );
    assert.equal(rejected.status, "failed");
    assert.match(rejected.error!, /GPU trống/);
    await controlWorkspace(admin, rejected.id, "cancel-failed");
    assert.equal(await db().exists(key(`gpu:active:${team.id}`)), 0);
    mode = "ok";
    const dedicated = await deployWorkspace(
      admin,
      team.id,
      c.roundId!,
      t.id,
      0.75,
    );
    // Reproduce a pre-feature allocation without slot metadata. It must coexist
    // with shared Pods, while still preventing duplicate private services.
    const legacy = { ...(await getWorkspace(dedicated.id)) };
    delete legacy.reservationVersion;
    delete legacy.scope;
    delete legacy.services;
    await db().set(key(`gpu:workspace:${legacy.id}`), legacy);
    await db().del(
      ...["llm", "jupyter"].map((service) =>
        key(`gpu:active:v2:team:${team.id}:${c.roundId}:${service}`),
      ),
    );
    await db().set(key(`gpu:active:${team.id}`), legacy.id);
    await assert.rejects(
      () =>
        deployWorkspace(admin, team.id, c.roundId!, t.id, 0.75, {
          services: "jupyter",
        }),
      /đã có Pod/,
    );

    const beforeShared = creates;
    const sharedAttempts = await Promise.allSettled([
      deployWorkspace(admin, null, c.roundId!, t.id, 0.75, {
        scope: "all",
        services: "llm",
      }),
      deployWorkspace(admin, null, c.roundId!, t.id, 0.75, {
        scope: "all",
        services: "llm",
      }),
    ]);
    assert.equal(
      sharedAttempts.filter((r) => r.status === "fulfilled").length,
      1,
    );
    assert.equal(creates, beforeShared + 1);
    const sharedLlm = sharedAttempts.find(
      (
        r,
      ): r is PromiseFulfilledResult<
        Awaited<ReturnType<typeof deployWorkspace>>
      > => r.status === "fulfilled",
    )!.value;
    const sharedJupyter = await deployWorkspace(
      admin,
      null,
      c.roundId!,
      t.id,
      0.75,
      { scope: "all", services: "jupyter" },
    );
    await assert.rejects(
      () =>
        deployWorkspace(admin, null, c.roundId!, t.id, 0.75, {
          scope: "all",
          services: "both",
        }),
      /đã có Pod/,
    );
    await Promise.all([
      syncWorkspace(admin, sharedLlm.id),
      syncWorkspace(admin, sharedJupyter.id),
      syncWorkspace(admin, dedicated.id),
    ]);
    const ownState = await workspaceState(member);
    assert.equal(
      ownState.workspaces.filter((w) => w.status === "running").length,
      3,
    );
    assert.equal(
      ownState.workspaces.filter((w) => w.scope === "all").length,
      2,
    );

    const secondMember = { ...other, id: randomUUID(), teamId: randomUUID() };
    const secondTeam: Team = {
      ...team,
      id: secondMember.teamId,
      name: "Đội QA tạo sau Pod",
      members: [secondMember.id],
      captainId: secondMember.id,
    };
    await db().hset(key("teams"), { [secondTeam.id]: secondTeam });
    // A shared grant includes new teams without copying records or requiring a
    // registration. Private allocations continue to require registration.
    const secondState = await workspaceState(secondMember);
    assert.equal(secondState.workspaces.length, 2);
    await assert.rejects(
      () => accessWorkspace(secondMember, dedicated.id),
      /không thuộc/,
    );
    await assert.rejects(
      () => accessWorkspace({ ...secondMember, teamId: null }, sharedLlm.id),
      /không thuộc/,
    );
    assert.equal(
      (await workspaceState({ ...secondMember, teamId: null })).workspaces
        .length,
      0,
    );
    assert.ok(
      (await launchNotebook(secondMember, sharedJupyter.id)).includes(
        "8888.proxy.runpod.net",
      ),
    );
    await assert.rejects(
      () => launchNotebook(secondMember, sharedLlm.id),
      /không cung cấp JupyterLab/,
    );
    await assert.rejects(
      () => readChat(secondMember, sharedJupyter.id, randomUUID()),
      /không cung cấp Chatbot/,
    );
    const llmRecord = await getWorkspace(sharedLlm.id),
      jupyterRecord = await getWorkspace(sharedJupyter.id);
    assert.equal(
      (
        await agentManifest(
          llmRecord.id,
          `Bearer ${decryptSecret(llmRecord.secret)}`,
        )
      ).assets.length,
      0,
    );
    const jupyterManifest = await agentManifest(
      jupyterRecord.id,
      `Bearer ${decryptSecret(jupyterRecord.secret)}`,
    );
    assert.equal(jupyterManifest.assets.length, 1);
    assert.equal(jupyterManifest.assets[0].workspaceLayout, "task-root");
    assert.equal(jupyterManifest.llmEnabled, false);

    const commonSession = randomUUID();
    await sendChat(member, sharedLlm.id, commonSession, randomUUID(), "Đội A");
    assert.equal(
      (await readChat(secondMember, sharedLlm.id, commonSession)).session
        .messages.length,
      0,
    );
    await sendChat(
      secondMember,
      sharedLlm.id,
      commonSession,
      randomUUID(),
      "Đội B",
    );
    assert.equal(
      (await readChat(member, sharedLlm.id, commonSession)).session.messages[0]
        .content,
      "Đội A",
    );
    assert.equal(
      (await readChat(secondMember, sharedLlm.id, commonSession)).session
        .messages[0].content,
      "Đội B",
    );
    assert.equal(
      (await readChat(admin, sharedLlm.id, commonSession)).session.messages
        .length,
      0,
    );
    await controlWorkspace(admin, sharedLlm.id, "terminate");
    assert.equal(
      await db().exists(key(`gpu:active:v2:all:all:${c.roundId}:llm`)),
      0,
    );
    assert.equal(
      await db().exists(key(`gpu:active:v2:all:all:${c.roundId}:jupyter`)),
      1,
    );
    await controlWorkspace(admin, sharedJupyter.id, "terminate");
    await controlWorkspace(admin, dedicated.id, "terminate");
    const emptyNotebook = await deployWorkspace(
      admin,
      null,
      c.roundId!,
      t.id,
      0.75,
      { scope: "all", services: "jupyter", loadDataset: false },
    );
    const emptyRecord = await getWorkspace(emptyNotebook.id);
    const emptyManifest = await agentManifest(
      emptyRecord.id,
      `Bearer ${decryptSecret(emptyRecord.secret)}`,
    );
    assert.equal(emptyRecord.loadDataset, false);
    assert.equal(emptyManifest.loadDataset, false);
    assert.equal(emptyManifest.assets.length, 0);
    assert.equal(emptyManifest.active, true);
    assert.equal(emptyManifest.llmEnabled, false);
    await controlWorkspace(admin, emptyNotebook.id, "terminate");
    assert.equal(await db().exists(key(`gpu:active:${team.id}`)), 0);
    console.log(
      "PASS: shared/private coexistence, future teams, team-isolated chat, single-service access/manifest, legacy reservation compatibility, atomic concurrent deployment, lifecycle, phase gates and token accounting.",
    );
    if (process.argv.includes("--keep")) {
      mode = "ok";
      const fixture = await deployWorkspace(
        admin,
        team.id,
        c.roundId!,
        t.id,
        0.75,
      );
      await syncWorkspace(member, fixture.id);
      await mkdir(".local", { recursive: true });
      await writeFile(
        ".local/gpu-qa.json",
        JSON.stringify({
          namespace: process.env.ARENA_NAMESPACE,
          encryptionKey: process.env.GPU_WORKSPACE_ENCRYPTION_KEY,
          workspaceId: fixture.id,
          roundId: c.roundId,
          admin: admin.username,
          member: member.username,
          password: "Arena-GPU-QA-Only-2026!",
        }),
      );
      console.log(
        "QA UI fixture saved in .local/gpu-qa.json; no real Pod exists.",
      );
      return;
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (!process.argv.includes("--keep")) {
      const prefix = process.env.ARENA_NAMESPACE! + ":";
      let cursor = "0";
      do {
        const [next, keys] = await db().scan(cursor, {
          match: prefix + "*",
          count: 100,
        });
        cursor = String(next);
        if (keys.length) {
          assert.ok(keys.every((k) => k.startsWith(prefix)));
          await db().del(...keys);
        }
      } while (cursor !== "0");
    }
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "QA failed");
  process.exitCode = 1;
});
