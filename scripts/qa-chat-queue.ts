/** Real Redis, isolated namespace; fake Runpod/model. Never allocates a paid GPU. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db, key, serverNow } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { encryptSecret, decryptSecret } from "../src/lib/workspace-crypto";
import {
  resetSharedTemplates,
  restoreSharedTemplateBackup,
} from "../src/lib/template-migration";
import { readTemplates } from "../src/lib/workspace-templates";
import {
  createChatGroup,
  getChatGroup,
  controlChatGroup,
  chatGroupViews,
  drainChatWorker,
} from "../src/lib/chat-groups";
import {
  enqueueChat,
  readQueuedChat,
  workerAction,
  reconcileChat,
  jobKey,
  settleUncertain,
  type ChatJob,
} from "../src/lib/chat-queue";
import {
  saveTemplate,
  deployWorkspace,
  syncWorkspace,
  getWorkspace,
  controlWorkspace,
  workspaceState,
  agentManifest,
  launchNotebook,
} from "../src/lib/workspaces";
import { defaultTemplate } from "../src/lib/workspace-domain";
import type { Contest, SafeUser, Team } from "../src/lib/types";

export async function runQueueQa() {
  process.env.ARENA_NAMESPACE = `arena:qa:gpu:${randomUUID()}`;
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.GPU_WORKSPACE_PUBLIC_URL = "https://qa.example.test";
  const namespace = process.env.ARENA_NAMESPACE;
  const originalFetch = globalThis.fetch,
    pods: {
      id: string;
      name: string;
      desiredStatus: string;
      costPerHr: number;
    }[] = [];
  let creates = 0,
    mode: "ok" | "timeout" | "reject" = "ok";
  globalThis.fetch = async (input, init) => {
    const url = String(input),
      response = (v: unknown) => Response.json(v);
    if (url === "https://api.runpod.io/v2/catalog/gpus")
      return response({
        gpus: [
          {
            id: "NVIDIA A40",
            name: "A40",
            memory: 48,
            price: { secure: 0.7, community: 0.59 },
          },
          {
            id: "NVIDIA RTX A5000",
            name: "A5000",
            memory: 24,
            price: { secure: 0.3, community: 0.27 },
          },
        ],
      });
    if (url === "https://api.runpod.io/graphql") {
      const v = JSON.parse(String(init?.body));
      if (v.query.includes("ArenaCreate")) {
        creates++;
        if (mode === "reject")
          return response({
            errors: [
              {
                message: "No instances available",
                extensions: { code: "SUPPLY_CONSTRAINT" },
              },
            ],
          });
        const pod = {
          id: `qapod${creates}abc`,
          name: v.variables.input.name,
          desiredStatus: "RUNNING",
          costPerHr: 0.704,
        };
        pods.push(pod);
        if (mode === "timeout") throw new Error("QA lost create ACK");
        assert.equal(v.variables.input.gpuCount, 1);
        return response({ data: { podFindAndDeployOnDemand: pod } });
      }
      if (v.query.includes("ArenaPods"))
        return response({ data: { myself: { pods } } });
      const pod = pods.find((p) => p.id === v.variables.input.podId);
      if (v.query.includes("ArenaTerminate")) {
        if (pod) pods.splice(pods.indexOf(pod), 1);
        return response({ data: { podTerminate: null } });
      }
      if (v.query.includes("ArenaStop")) {
        if (pod) pod.desiredStatus = "EXITED";
        return response({ data: { podStop: pod } });
      }
      if (v.query.includes("ArenaResume")) {
        if (pod) pod.desiredStatus = "RUNNING";
        return response({ data: { podResume: pod } });
      }
      return response(pod);
    }
    if (url.includes(".proxy.runpod.net"))
      return response({
        jupyter: true,
        llm: true,
        chatQueueProtocol: 1,
        publicReady: true,
        privateReady: false,
        stage: "QA fixture",
      });
    return originalFetch(input, init);
  };
  const now = await serverNow(),
    admin: SafeUser = {
      id: randomUUID(),
      username: "qa_gpu_admin",
      name: "Admin QA",
      admin: true,
      teamId: null,
      createdAt: now,
    };
  const admin2: SafeUser = {
    ...admin,
    id: randomUUID(),
    username: "qa_gpu_admin2",
  };
  const teams: Team[] = Array.from({ length: 7 }, (_, i) => ({
    id: randomUUID(),
    name: `Team ${i}`,
    captainId: "",
    members: [],
    inviteCode: randomUUID(),
    createdAt: now,
  }));
  const users: SafeUser[] = teams.flatMap((t, i) =>
    [0, 1].map((n) => {
      const u: SafeUser = {
        id: randomUUID(),
        username: `qa_gpu_member_${i}_${n}`,
        name: `User ${i}/${n}`,
        teamId: t.id,
        admin: false,
        createdAt: now,
      };
      t.members.push(u.id);
      t.captainId ||= u.id;
      return u;
    }),
  );
  const c: Contest = {
    id: randomUUID(),
    roundId: randomUUID(),
    title: "GPU Queue QA",
    startAt: now - 1000,
    forcedEndAt: null,
    publicSeconds: 18000,
    privateSeconds: 3600,
    publicLimit: 20,
    privateLimit: 5,
    createdAt: now,
  };
  const image = "nguyenlong26/olpai-workspace@sha256:" + "a".repeat(64),
    password = "Arena-GPU-QA-Only-2026!";
  const member = users[0];
  try {
    const hashed = await hashPassword(password);
    for (const u of [admin, admin2, ...users]) {
      const { admin: _admin, ...record } = u;
      await db().set(key(`user:${u.id}`), { ...record, password: hashed });
      await db().set(key(`username:${u.username}`), u.id);
    }
    await db().set(key("admin"), admin.id);
    await db().sadd(key("admins"), admin2.id);
    await db().hset(
      key("teams"),
      Object.fromEntries(teams.map((t) => [t.id, t])),
    );
    await db().set(key(`round:${c.roundId}`), c);
    await db().zadd(key("rounds"), { score: now, member: c.roundId! });
    await db().hset(key(`registrations:${c.roundId}`), {
      [member.id]: { userId: member.id, status: "approved", registeredAt: now },
    });
    await db().set(
      key(`gpu:credential:${admin.id}`),
      encryptSecret("qa-fake-runpod-key"),
    );
    await saveTemplate({ ...defaultTemplate, imageName: image });
    const dry = await resetSharedTemplates(image);
    assert.equal(dry.applied, false);
    assert.equal(
      (await readTemplates(admin.id))[defaultTemplate.id].name,
      defaultTemplate.name,
    );
    assert.equal((await resetSharedTemplates(image, true)).applied, true);
    assert.equal(
      (await resetSharedTemplates(image, true)).alreadyApplied,
      true,
    );
    assert.equal(Object.keys(await readTemplates(admin2.id)).length, 3);
    await restoreSharedTemplateBackup();
    assert.ok((await readTemplates(admin.id))[defaultTemplate.id]);
    await resetSharedTemplates(image, true);
    const templates = Object.values(await readTemplates(admin.id)),
      both = templates.find((t) => t.services === "both")!,
      llm = templates.find((t) => t.services === "llm")!;
    const saved = await saveTemplate(
      { ...llm, name: "Shared edited by admin 2" },
      admin2.id,
      { overwrite: true, expectedRevision: llm.revision },
    );
    assert.equal((await readTemplates(admin.id))[llm.id].updatedBy, admin2.id);
    await assert.rejects(
      () =>
        saveTemplate(llm, admin.id, {
          overwrite: true,
          expectedRevision: llm.revision,
        }),
      /cửa sổ khác/,
    );
    const competing = await Promise.allSettled(
      [admin, admin2].map((u) =>
        saveTemplate({ ...saved, name: `Edit ${u.username}` }, u.id, {
          overwrite: true,
          expectedRevision: saved.revision,
        }),
      ),
    );
    assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
    const dedicatedAttempts = await Promise.allSettled(
      [0, 1].map(() =>
        deployWorkspace(admin, teams[0].id, c.roundId!, both.id, 0.8, {
          loadDataset: false,
        }),
      ),
    );
    assert.equal(
      dedicatedAttempts.filter((r) => r.status === "fulfilled").length,
      1,
    );
    const dedicated = (
      dedicatedAttempts.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<Awaited<ReturnType<typeof deployWorkspace>>>
    ).value;
    await syncWorkspace(admin, dedicated.id);
    assert.ok(
      (await launchNotebook(member, dedicated.id)).includes(
        "8888.proxy.runpod.net",
      ),
    );
    const group = await createChatGroup(admin, {
      id: randomUUID(),
      name: "QA Chatbot chung",
      scope: "all",
      roundId: c.roundId!,
      templateId: llm.id,
    });
    const allocation = randomUUID(),
      before = creates;
    const pair = await Promise.all(
      [0, 1].map(() =>
        deployWorkspace(admin, null, c.roundId!, llm.id, 0.8, {
          groupId: group.id,
          requestId: allocation,
          scope: "all",
          services: "llm",
        }),
      ),
    );
    assert.equal(pair[0].id, pair[1].id);
    assert.equal(creates, before + 1);
    const afterAllocation = await getChatGroup(group.id);
    assert.deepEqual(
      [
        afterAllocation.ownerId,
        afterAllocation.roundId,
        afterAllocation.scope,
        afterAllocation.teamId,
        afterAllocation.template.id,
        afterAllocation.retired,
      ],
      [
        group.ownerId,
        group.roundId,
        group.scope,
        group.teamId,
        group.template.id,
        undefined,
      ],
    );
    const second = await deployWorkspace(admin, null, c.roundId!, llm.id, 0.8, {
      groupId: group.id,
      requestId: randomUUID(),
      scope: "all",
      services: "llm",
    });
    for (const w of [pair[0], second]) await syncWorkspace(admin, w.id);
    const workerIds = [pair[0].id, second.id];
    const call = async (wid: string, action: string, v: object = {}) =>
      workerAction(
        action,
        {
          workspaceId: wid,
          protocol: 1,
          ready: true,
          fingerprint: "qa-identical-model",
          ...v,
        },
        `Bearer ${decryptSecret((await getWorkspace(wid)).secret)}`,
      ) as Promise<any>;
    const claim = (wid: string) => call(wid, "claim");
    const prepare = (wid: string, j: any) =>
      call(wid, "prepare", {
        requestId: j.requestId,
        attempt: j.attempt,
        promptTokens: 20,
      });
    const complete = (wid: string, j: any) =>
      call(wid, "complete", {
        requestId: j.requestId,
        attempt: j.attempt,
        inputTokens: 20,
        outputTokens: 5,
        content: "QA answer",
      });
    const send = (
      u = member,
      session = randomUUID(),
      content = "QA prompt",
      requestId = randomUUID(),
    ) => enqueueChat(u, undefined, session, requestId, content, group.id);
    for (const id of [dedicated.id, ...workerIds]) await claim(id);
    const common = randomUUID(),
      req = randomUUID();
    const sent = await send(member, common, "First", req);
    assert.equal(sent.session.messages.length, 1);
    assert.equal(sent.session.pending?.reserved, 0);
    await send(member, common, "First", req);
    await assert.rejects(
      () => send(member, common, "Different", req),
      /nội dung khác/,
    );
    const sameSession = await Promise.allSettled([
      send(member, common),
      send(member, common),
    ]);
    assert.equal(sameSession.filter((r) => r.status === "rejected").length, 2);
    await send();
    await send();
    await enqueueChat(
      member,
      dedicated.id,
      randomUUID(),
      randomUUID(),
      "Private Pod",
    );
    await assert.rejects(() => send(), /4 prompt/);
    const dedicatedJob = (await claim(dedicated.id)).job;
    await prepare(dedicated.id, dedicatedJob);
    await complete(dedicated.id, dedicatedJob);
    const simultaneous = await Promise.all(workerIds.map(claim));
    assert.notEqual(
      simultaneous[0].job.requestId,
      simultaneous[1].job.requestId,
    );
    for (let i = 0; i < 2; i++) {
      await prepare(workerIds[i], simultaneous[i].job);
      await complete(workerIds[i], simultaneous[i].job);
      await complete(workerIds[i], simultaneous[i].job);
    }
    let j = (await claim(workerIds[0])).job;
    await prepare(workerIds[0], j);
    await complete(workerIds[0], j);
    assert.equal(
      (await readQueuedChat(member, undefined, common, group.id)).session
        .messages.length,
      2,
    );
    assert.equal(
      (await readQueuedChat(member, undefined, common, group.id)).session
        .outputTokens,
      5,
    );
    assert.equal(
      (await readQueuedChat(users[2], undefined, common, group.id)).session
        .messages.length,
      0,
    );
    // Team rotation, preserving FIFO inside each lane.
    const a1 = await send(member),
      a2 = await send(member),
      b1 = await send(users[2]),
      c1 = await send(users[4]);
    const sequence: string[] = [];
    for (let i = 0; i < 4; i++) {
      const wid = workerIds[i % 2],
        j = (await claim(wid)).job;
      sequence.push(j.requestId);
      await prepare(wid, j);
      await complete(wid, j);
    }
    assert.deepEqual(sequence, [
      a1.requestId,
      b1.requestId,
      c1.requestId,
      a2.requestId,
    ]);
    // Lost claim ACK is safe to requeue; the previous attempt is fenced.
    await send(users[6]);
    j = (await claim(workerIds[0])).job;
    let raw = (await db().get<ChatJob>(jobKey(j.requestId)))!;
    await db().set(jobKey(raw.id), { ...raw, leaseUntil: now - 1 });
    await reconcileChat(`group:${group.id}`, c.id);
    const reclaimed = (await claim(workerIds[1])).job;
    assert.equal(reclaimed.requestId, j.requestId);
    assert.notEqual(reclaimed.attempt, j.attempt);
    await assert.rejects(() => prepare(workerIds[0], j), /không thuộc worker/);
    await prepare(workerIds[1], reclaimed);
    await complete(workerIds[1], reclaimed);
    // An uncertain running request is not reassigned; its journal may settle once.
    await send(users[8]);
    j = (await claim(workerIds[0])).job;
    await prepare(workerIds[0], j);
    raw = (await db().get<ChatJob>(jobKey(j.requestId)))!;
    await db().set(jobKey(raw.id), { ...raw, leaseUntil: now - 1 });
    await reconcileChat(`group:${group.id}`, c.id);
    assert.equal(
      (await db().get<ChatJob>(jobKey(raw.id)))!.status,
      "uncertain",
    );
    assert.equal((await claim(workerIds[1])).job, null);
    await complete(workerIds[0], j);
    await complete(workerIds[0], j);
    await send(users[10]);
    j = (await claim(workerIds[0])).job;
    await prepare(workerIds[0], j);
    raw = (await db().get<ChatJob>(jobKey(j.requestId)))!;
    await db().set(jobKey(raw.id), { ...raw, leaseUntil: now - 1 });
    await reconcileChat(`group:${group.id}`, c.id);
    await settleUncertain(admin, raw.id);
    assert.equal((await complete(workerIds[0], j)).accepted, false);
    // Drain does not cancel the running turn and prevents the next claim.
    await send(users[12]);
    j = (await claim(workerIds[0])).job;
    await prepare(workerIds[0], j);
    await assert.rejects(
      () => controlWorkspace(admin, workerIds[0], "stop"),
      /ngừng giao việc/,
    );
    await complete(workerIds[0], j);
    await send(users[12]);
    assert.equal((await claim(workerIds[0])).job, null);
    await drainChatWorker(admin, workerIds[0], false);
    j = (await claim(workerIds[0])).job;
    await prepare(workerIds[0], j);
    await complete(workerIds[0], j);
    await send(users[12]);
    await controlChatGroup(admin, group.id, "pause");
    await assert.rejects(() => send(users[12]), /tạm ngừng/);
    j = (await claim(workerIds[0])).job;
    assert.ok(j, "Pausing admission must still process accepted work");
    await prepare(workerIds[0], j);
    await complete(workerIds[0], j);
    await controlChatGroup(admin, group.id, "resume");
    await assert.rejects(
      () => call(workerIds[0], "claim", { fingerprint: "wrong-model" }),
      /không khớp/,
    );
    const views = await chatGroupViews(users[2]);
    assert.equal(views.length, 1);
    assert.equal("queue" in views[0], false);
    const safe = await workspaceState(member);
    assert.equal(safe.chatOperations.length, 0);
    assert.ok(
      !JSON.stringify(safe).includes((await getWorkspace(dedicated.id)).secret),
    );
    // Burst of 28 prompts across 14 accounts, all accepted and finished exactly once.
    const burst = await Promise.all(users.flatMap((u) => [send(u), send(u)]));
    assert.equal(new Set(burst.map((j) => j.requestId)).size, 28);
    for (let n = 0; n < 14; n++) {
      const batch = await Promise.all(workerIds.map(claim));
      await Promise.all(
        batch.map(async (r, i) => {
          assert.ok(r.job);
          await prepare(workerIds[i], r.job);
          await complete(workerIds[i], r.job);
        }),
      );
    }
    // Membership revocation is rechecked after inference, not only at enqueue.
    const outageJob = await send(users[6]);
    for (const wid of workerIds) {
      const worker = await db().get<Record<string, unknown>>(
        key(`gpu:worker:${wid}`),
      );
      await db().set(key(`gpu:worker:${wid}`), {
        ...worker,
        ready: false,
        heartbeatAt: now - 200000,
      });
    }
    await db().set(
      key(`gpu:unavailable:group:${group.id}:${c.id}`),
      now - 200000,
    );
    await reconcileChat(`group:${group.id}`, c.id);
    assert.equal(
      (await db().get<ChatJob>(jobKey(outageJob.requestId)))!.status,
      "failed",
    );
    for (const wid of workerIds) await claim(wid);
    const legacySession = randomUUID();
    await db().set(key(`gpu:chat:${dedicated.id}:${c.id}:${legacySession}`), {
      messages: [],
      inputTokens: 10,
      outputTokens: 20,
      pending: { requestId: randomUUID(), reserved: 30 },
    });
    const recoveredLegacy = await readQueuedChat(
      member,
      dedicated.id,
      legacySession,
    );
    assert.equal(recoveredLegacy.session.pending, undefined);
    assert.equal(
      recoveredLegacy.session.inputTokens +
        recoveredLegacy.session.outputTokens,
      30,
    );
    await send(users[2]);
    j = (await claim(workerIds[0])).job;
    await prepare(workerIds[0], j);
    const revoked = teams[1];
    await db().hset(key("teams"), {
      [revoked.id]: { ...revoked, members: [] },
    });
    assert.equal((await complete(workerIds[0], j)).accepted, false);
    await db().hset(key("teams"), { [revoked.id]: revoked });
    // A running job from a previous run cannot publish into a reset round.
    await send(users[4]);
    j = (await claim(workerIds[0])).job;
    await prepare(workerIds[0], j);
    const previousRun = c.id;
    c.id = randomUUID();
    await db().set(key(`round:${c.roundId}`), c);
    assert.equal((await complete(workerIds[0], j)).accepted, false);
    assert.equal(
      (await db().get<ChatJob>(jobKey(j.requestId)))!.status,
      "cancelled",
    );
    await assert.rejects(
      () =>
        enqueueChat(
          member,
          undefined,
          randomUUID(),
          randomUUID(),
          "Stale run",
          group.id,
          previousRun,
        ),
      /vừa thay đổi/,
    );
    for (const wid of workerIds) await claim(wid);
    // Public cutoff suppresses running results and cancels waiting work.
    await send(users[2]);
    await send(users[4]);
    j = (await claim(workerIds[0])).job;
    await prepare(workerIds[0], j);
    c.privateAt = await serverNow();
    await db().set(key(`round:${c.roundId}`), c);
    assert.equal((await complete(workerIds[0], j)).accepted, false);
    await reconcileChat(`group:${group.id}`, c.id);
    assert.equal(
      (await db().get<ChatJob>(jobKey(j.requestId)))!.status,
      "cancelled",
    );
    assert.equal(
      (
        await agentManifest(
          dedicated.id,
          `Bearer ${decryptSecret((await getWorkspace(dedicated.id)).secret)}`,
        )
      ).llmEnabled,
      false,
    );
    c.privateAt = null;
    c.id = randomUUID();
    await db().set(key(`round:${c.roundId}`), c);
    assert.equal(
      (await readQueuedChat(member, undefined, common, group.id)).session
        .messages.length,
      0,
    );
    // Partial stock/unknown creation failures preserve the working group members.
    mode = "reject";
    const rejected = await deployWorkspace(
      admin,
      null,
      c.roundId!,
      llm.id,
      0.8,
      {
        groupId: group.id,
        requestId: randomUUID(),
        scope: "all",
        services: "llm",
      },
    );
    assert.equal(rejected.status, "failed");
    assert.equal((await getChatGroup(group.id)).workspaceIds.length, 3);
    await controlWorkspace(admin, rejected.id, "cancel-failed");
    mode = "timeout";
    const lost = await deployWorkspace(admin, null, c.roundId!, llm.id, 0.8, {
      groupId: group.id,
      requestId: randomUUID(),
      scope: "all",
      services: "llm",
    });
    assert.equal(lost.status, "reconciling");
    assert.equal(lost.estimatedUsd, 0);
    await assert.rejects(
      () =>
        deployWorkspace(admin, null, c.roundId!, llm.id, 0.8, {
          groupId: group.id,
          requestId: randomUUID(),
          scope: "all",
          services: "llm",
        }),
      /chưa xác nhận/,
    );
    mode = "ok";
    await syncWorkspace(admin, lost.id);
    assert.ok((await getWorkspace(lost.id)).podId);
    if (process.argv.includes("--keep")) {
      await mkdir(".local", { recursive: true });
      await writeFile(
        ".local/gpu-qa.json",
        JSON.stringify({
          namespace,
          encryptionKey: process.env.GPU_WORKSPACE_ENCRYPTION_KEY,
          workspaceId: dedicated.id,
          groupId: group.id,
          roundId: c.roundId,
          admin: admin.username,
          member: member.username,
          password,
        }),
      );
    }
    console.log(
      "PASS queue QA: real isolated Redis, fake Runpod/model; atomic allocation/claim, 28-request burst, team fairness/caps, journal recovery, leases, drain, cutoff, isolation, shared templates and backup restore.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (!process.argv.includes("--keep")) {
      let cursor = "0";
      do {
        const [next, keys] = await db().scan(cursor, {
          match: namespace + ":*",
          count: 250,
        });
        cursor = String(next);
        if (keys.length) {
          assert.ok(keys.every((k) => k.startsWith(namespace + ":")));
          await db().del(...keys);
        }
      } while (cursor !== "0");
    }
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/qa-chat-queue.ts"))
  runQueueQa().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
