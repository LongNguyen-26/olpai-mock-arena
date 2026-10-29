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
  gpuResources,
  setMetricsVisible,
  launchNotebook,
  readChat,
  saveCredential,
  saveTemplate,
  sendChat as enqueueChat,
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
import { readTemplates } from "../src/lib/workspace-templates";
import { workerAction } from "../src/lib/chat-queue";
import { control, getContest } from "../src/lib/rounds";

async function main() {
  process.env.ARENA_NAMESPACE = `arena:qa:gpu:${randomUUID()}`;
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.GPU_WORKSPACE_PUBLIC_URL = "https://qa.example.test";
  const originalFetch = globalThis.fetch;
  let creates = 0,
    providerControls = 0,
    generations = 0,
    tokenCount = 20,
    tokenCounts = 0,
    mode: "ok" | "timeout" | "reject" = "ok";
  let runtimeAvailable = true,
    systemLog = "Pulling image",
    logReads = 0;
  // Drive the durable protocol explicitly; the model remains a CPU-only stub.
  async function sendChat(...args: Parameters<typeof enqueueChat>) {
    await enqueueChat(...args);
    const w = await getWorkspace(args[1]!);
    const base = {
      workspaceId: w.id,
      protocol: 1,
      ready: true,
      fingerprint: "qa-model",
    };
    const auth = `Bearer ${decryptSecret(w.secret)}`;
    const claimed = (await workerAction("claim", base, auth)) as {
      job?: { requestId: string; attempt: string };
    };
    if (claimed.job) {
      const job = claimed.job;
      tokenCounts++;
      if (!Number.isInteger(tokenCount)) {
        await workerAction("fail", { ...base, ...job }, auth);
        throw new Error("Dịch vụ trả số token không hợp lệ.");
      }
      const prepared = (await workerAction(
        "prepare",
        { ...base, ...job, promptTokens: tokenCount },
        auth,
      )) as { execute?: boolean };
      if (prepared.execute) {
        generations++;
        await workerAction(
          "complete",
          {
            ...base,
            ...job,
            content: "Phản hồi QA từ runtime giả lập.",
            inputTokens: tokenCount,
            outputTokens: 10,
          },
          auth,
        );
      }
    }
    return readChat(args[0], args[1], args[2]);
  }
  const pods: RunpodPod[] = [];
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (/^https:\/\/api\.runpod\.io\/v2\/pods\/[^/]+\/logs\?/.test(url)) {
      logReads++;
      return new Response(
        `data: ${JSON.stringify({ source: "system", line: systemLog })}\n\n`,
      );
    }
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
      if (request.query.includes("ArenaGpuResources"))
        return json({
          data: {
            gpuTypes: [
              {
                id: request.variables.gpu.id,
                lowestPrice: {
                  minMemory: 50,
                  minVcpu: 9,
                  stockStatus: "Medium",
                },
              },
            ],
          },
        });
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
        providerControls++;
        pods.splice(pods.indexOf(pod), 1);
        return json({ data: { podTerminate: null } });
      }
      if (request.query.includes("ArenaStop")) {
        providerControls++;
        pod.desiredStatus = "EXITED";
        return json({ data: { podStop: pod } });
      }
      if (request.query.includes("ArenaResume")) {
        providerControls++;
        pod.desiredStatus = "RUNNING";
        return json({ data: { podResume: pod } });
      }
      return json(pod);
    }
    if (url.includes(".proxy.runpod.net")) {
      if (url.endsWith("/api/status")) return json({ status: "ok" });
      if (url.endsWith("/health") && !runtimeAvailable) return json({}, 502);
      if (url.endsWith("/health"))
        return json({
          jupyter: true,
          llm: true,
          publicReady: true,
          privateReady: false,
          stage: "QA fixture",
          gpu: "A40, 21000 MiB, 49140 MiB, 0 %",
        });
      if (url.endsWith("/token-count")) {
        tokenCounts++;
        return json({ count: tokenCount });
      }
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
    // RUNNING is only desired state: the host can fail before the container
    // starts. Keep billing/reservation, report safe diagnostics, then recover
    // the same Pod when health returns. No replacement mutation is allowed.
    const forceSync = async (recheckLogs = true) => {
      await db().set(key(`gpu:workspace:${w.id}`), {
        ...(await getWorkspace(w.id)),
        syncedAt: 0,
        ...(recheckLogs ? { startupCheckedAt: 0 } : {}),
      });
      return syncWorkspace(admin, w.id);
    };
    runtimeAvailable = false;
    const starting = await forceSync();
    assert.equal(starting.status, "provisioning");
    assert.equal(starting.health, null);
    assert.match(starting.error!, /chưa xác nhận container/);
    systemLog =
      "error creating container: nvidia-smi: failed to parse ([GPU requires reset]) secret-not-for-client";
    const broken = await forceSync();
    assert.equal(broken.status, "failed");
    assert.equal(broken.startupFailure, "gpu-reset");
    assert.match(broken.error!, /GPU trên host Runpod cần reset/);
    assert.ok(!JSON.stringify(broken).includes("secret-not-for-client"));
    assert.ok(broken.meterRate > 0);
    assert.equal(broken.podId, starting.podId);
    const reads = logReads;
    assert.equal((await forceSync(false)).status, "failed");
    assert.equal(logReads, reads, "cache system-log checks for 60 seconds");
    await assert.rejects(
      () => deployWorkspace(admin, team.id, c.roundId!, t.id, 0.75),
      /đã có Pod/,
    );
    assert.equal(creates, 1);
    runtimeAvailable = true;
    const recovered = await forceSync(false);
    assert.equal(recovered.status, "running");
    assert.equal(recovered.health?.llm, true);
    assert.equal(recovered.startupFailure, null);
    assert.equal(recovered.error, null);
    assert.equal(recovered.podId, broken.podId);
    console.log(
      "Startup QA: desired RUNNING, host GPU reset, safe logs, billing, reservation and recovery passed.",
    );
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
    await sendChat(member, w.id, session, requestId, "Hướng dẫn baseline");
    assert.equal(generations, 1);
    assert.equal(
      (await readChat(member, w.id, session)).session.messages.length,
      2,
    );
    tokenCount = 1801;
    const closedId = randomUUID(),
      closedRequest = randomUUID(),
      beforeCounts = tokenCounts;
    const closed = await sendChat(
      member,
      w.id,
      closedId,
      closedRequest,
      "Oversized QA prompt",
    );
    assert.equal(
      closed.session.messages.at(-1)?.content,
      "Oversized QA prompt",
    );
    assert.equal(closed.session.inputTokens + closed.session.outputTokens, 0);
    assert.match(closed.session.error!, /Input vượt/);
    assert.equal(generations, 1);
    await sendChat(
      member,
      w.id,
      closedId,
      closedRequest,
      "Oversized QA prompt",
    );
    assert.equal(tokenCounts, beforeCounts + 1);
    assert.equal(
      (await readChat(member, w.id, closedId)).session.messages.length,
      1,
    );
    tokenCount = 20;
    const budgetId = randomUUID();
    await db().set(key(`gpu:chat:${w.id}:${c.id}:${budgetId}`), {
      messages: [],
      inputTokens: 1990,
      outputTokens: 0,
    });
    const budgetClosed = await sendChat(
      member,
      w.id,
      budgetId,
      randomUUID(),
      "Fits input but exceeds session budget",
    );
    assert.match(budgetClosed.session.error!, /hết ngân sách/);
    assert.equal(budgetClosed.session.messages.length, 1);
    tokenCount = NaN;
    await assert.rejects(
      () =>
        sendChat(
          member,
          w.id,
          randomUUID(),
          randomUUID(),
          "Bad provider count",
        ),
      /số token không hợp lệ/,
    );
    tokenCount = 20;
    // A fresh UUID has an independent ledger and can generate normally.
    const fresh = await sendChat(
      member,
      w.id,
      randomUUID(),
      randomUUID(),
      "Fresh QA prompt",
    );
    assert.equal(fresh.session.exhausted, undefined);
    assert.equal(generations, 2);
    assert.deepEqual(await gpuResources(admin, "NVIDIA A40", "SECURE"), {
      minRAMPerGPU: 50,
      minVCPUPerGPU: 9,
      stockStatus: "Medium",
    });
    await assert.rejects(
      () => setMetricsVisible(member, w.id, false),
      /Chỉ admin/,
    );
    await setMetricsVisible(admin, w.id, false);
    assert.equal(
      (await workspaceState(member)).workspaces.find((x) => x.id === w.id)
        ?.health?.gpu,
      undefined,
    );
    assert.equal((await syncWorkspace(member, w.id)).health?.gpu, undefined);
    assert.ok(
      (await workspaceState(admin)).workspaces.find((x) => x.id === w.id)
        ?.health?.gpu,
    );
    await setMetricsVisible(admin, w.id, true);
    const otherOwner = randomUUID();
    await saveTemplate({ ...t, name: "Other admin template" }, otherOwner, {
      overwrite: true,
      expectedRevision: "legacy",
    });
    assert.equal(
      (await readTemplates(admin.id))[t.id].name,
      "Other admin template",
    );
    assert.equal(
      (await readTemplates(otherOwner))[t.id].name,
      "Other admin template",
    );
    const competing = await Promise.allSettled([
      saveTemplate(
        { ...t, id: randomUUID(), name: "Concurrent name" },
        otherOwner,
      ),
      saveTemplate(
        { ...t, id: randomUUID(), name: "Concurrent name" },
        otherOwner,
      ),
    ]);
    assert.equal(competing.filter((x) => x.status === "fulfilled").length, 1);
    let policy = await saveTemplate(
      {
        ...t,
        tokenLimitMode: "turn",
        inputTokenLimit: 64,
        outputTokenLimit: 64,
      },
      admin.id,
      {
        overwrite: true,
        expectedRevision: (await readTemplates(admin.id))[t.id].revision,
      },
    );
    assert.equal(
      (await readChat(member, w.id, session)).template.tokenLimitMode,
      "turn",
    );
    const turnId = randomUUID();
    await db().set(key(`gpu:chat:${w.id}:${c.id}:${turnId}`), {
      messages: [],
      inputTokens: 5000,
      outputTokens: 5000,
    });
    await assert.rejects(
      () => sendChat(member, w.id, turnId, randomUUID(), "Per-turn QA"),
      /hết ngân sách/,
    );
    tokenCount = 65;
    const rejectedId = randomUUID();
    const rejectedTurn = await sendChat(
      member,
      w.id,
      rejectedId,
      randomUUID(),
      "Oversized per-turn QA",
    );
    assert.equal(rejectedTurn.session.exhausted, undefined);
    assert.equal(rejectedTurn.session.messages.at(-1)?.rejected, true);
    tokenCount = 20;
    const recoveredTurn = await sendChat(
      member,
      w.id,
      rejectedId,
      randomUUID(),
      "Short prompt",
    );
    assert.equal(recoveredTurn.session.messages.length, 3);
    assert.equal(recoveredTurn.session.limitNotice, undefined);
    policy = await saveTemplate(
      { ...policy, tokenLimitMode: "session" },
      admin.id,
      { overwrite: true, expectedRevision: policy.revision },
    );
    const separateId = randomUUID();
    await db().set(key(`gpu:chat:${w.id}:${c.id}:${separateId}`), {
      messages: [],
      inputTokens: 50,
      outputTokens: 10,
    });
    const separate = await sendChat(
      member,
      w.id,
      separateId,
      randomUUID(),
      "Per-session input budget",
    );
    assert.match(separate.session.error!, /Input cộng dồn/);
    assert.equal(separate.session.inputTokens, 50);
    await assert.rejects(
      () =>
        saveTemplate({ ...policy, name: "stale" }, admin.id, {
          overwrite: true,
          expectedRevision: "legacy",
        }),
      /cửa sổ khác/,
    );
    await saveTemplate(t, admin.id, {
      overwrite: true,
      expectedRevision: policy.revision,
    });
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
      /khóa/,
    );
    const beforeControls = providerControls,
      beforeCreates = creates;
    await syncWorkspace(member, w.id);
    async function roundChange(
      action: string,
      values: Record<string, unknown> = {},
    ) {
      const current = await getContest(c.roundId!);
      await control(
        action,
        {
          ...values,
          action,
          runId: current.id,
          revision: current.revision ?? 0,
          requestId: randomUUID(),
        },
        c.roundId!,
      );
    }
    await roundChange("chatbot-access", { enabled: true, until: null });
    assert.equal(
      (await agentManifest(w.id, `Bearer ${decryptSecret(stored.secret)}`))
        .llmEnabled,
      true,
    );
    const lateSession = randomUUID(),
      lateRequest = randomUUID();
    await enqueueChat(
      member,
      w.id,
      lateSession,
      lateRequest,
      "Must not publish after revoke",
    );
    const workerBase = {
      workspaceId: w.id,
      protocol: 1,
      ready: true,
      fingerprint: "qa-model",
    };
    const workerAuth = `Bearer ${decryptSecret(stored.secret)}`;
    const claim = (await workerAction("claim", workerBase, workerAuth)) as {
      job: { requestId: string; attempt: string };
    };
    assert.ok(claim.job);
    assert.equal(
      (
        (await workerAction(
          "prepare",
          { ...workerBase, ...claim.job, promptTokens: 20 },
          workerAuth,
        )) as { execute: boolean }
      ).execute,
      true,
    );
    await roundChange("chatbot-access", { enabled: false, until: null });
    await roundChange("chatbot-access", { enabled: true, until: null });
    const late = (await workerAction(
      "complete",
      {
        ...workerBase,
        ...claim.job,
        content: "Late forbidden output",
        inputTokens: 20,
        outputTokens: 10,
      },
      workerAuth,
    )) as { accepted: boolean };
    assert.equal(late.accepted, false);
    assert.ok(
      !(await readChat(member, w.id, lateSession)).session.messages.some(
        (m) => m.content === "Late forbidden output",
      ),
    );
    for (const visible of [false, true, false, true])
      await roundChange("submission-access", {
        split: "private",
        visible,
        enabled: true,
      });
    assert.equal((await agentManifest(w.id, workerAuth)).llmEnabled, true);
    await control("finish", {}, c.roundId!);
    await roundChange("practice-open", {
      endAt: null,
      publicVisible: true,
      privateVisible: true,
      chatbotEnabled: true,
      chatbotUntil: null,
      notebookEnabled: true,
    });
    const practiceManifest = await agentManifest(w.id, workerAuth);
    assert.equal(practiceManifest.phase, "practice");
    assert.equal(practiceManifest.llmEnabled, true);
    assert.equal(practiceManifest.publicEndsAt, null);
    assert.ok(
      (await launchNotebook(member, w.id)).includes("8888.proxy.runpod.net"),
    );
    const practiceAnswer = await sendChat(
      member,
      w.id,
      randomUUID(),
      randomUUID(),
      "Practice still allows chatbot",
    );
    assert.equal(practiceAnswer.session.messages.length, 2);
    await roundChange("notebook-access", { enabled: false });
    await assert.rejects(() => launchNotebook(member, w.id), /đang khóa/);
    await roundChange("practice-close");
    assert.equal((await agentManifest(w.id, workerAuth)).llmEnabled, false);
    assert.equal(providerControls, beforeControls);
    assert.equal(creates, beforeCreates);
    console.log(
      "PASS: private chatbot reopen, late-response fence, independent submission visibility, practice manifest/chat/Lab, and zero Pod lifecycle mutations.",
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
    await db().set(key(`user:${secondMember.id}`), {
      ...secondMember,
      password: "unused-qa-hash",
    });
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

    const visibleRound = await db().get<Contest>(key(`round:${c.roundId}`));
    assert.ok(visibleRound);
    await db().set(key(`round:${c.roundId}`), {
      ...visibleRound,
      hidden: true,
    });
    assert.equal(
      (
        await agentManifest(
          llmRecord.id,
          `Bearer ${decryptSecret(llmRecord.secret)}`,
        )
      ).active,
      false,
    );
    await assert.rejects(
      () => accessWorkspace(member, sharedLlm.id),
      /Không tìm thấy vòng/,
    );
    assert.equal((await workspaceState(member)).workspaces.length, 0);
    assert.ok((await workspaceState(admin)).workspaces.length >= 3);
    await db().set(key(`round:${c.roundId}`), visibleRound);

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
    const archivedRound = await db().get<Contest>(key(`round:${c.roundId}`));
    assert.ok(archivedRound);
    await db().set(key(`round:${c.roundId}`), {
      ...archivedRound,
      deletedAt: Date.now(),
    });
    assert.ok(
      (await workspaceState(admin)).workspaces.every(
        (w) => !w.notebookEnabled && !w.chatbotEnabled,
      ),
    );
    assert.equal((await workspaceState(member)).workspaces.length, 0);
    assert.equal(
      (
        await agentManifest(
          emptyRecord.id,
          `Bearer ${decryptSecret(emptyRecord.secret)}`,
        )
      ).active,
      false,
    );
    await db().set(key(`round:${c.roundId}`), archivedRound);
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
