/** Isolated real-Redis QA. Runpod, runtime and GPU are entirely stubbed. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db, key, serverNow } from "../src/lib/db";
import {
  deployWorkspace,
  getWorkspace,
  saveCredential,
  saveTemplate,
  syncWorkspace,
  workspaceState,
  agentManifest,
  launchNotebook,
} from "../src/lib/workspaces";
import {
  defaultTemplate,
  type WorkspaceTemplate,
} from "../src/lib/workspace-domain";
import { decryptSecret } from "../src/lib/workspace-crypto";
import {
  authorizeHub,
  redeemHub,
  receiveHubReport,
  changeHubTeam,
  changeHubServer,
  controlManual,
  manualConfiguration,
} from "../src/lib/hub-service";
import { gpuTurn, readGpuTurns } from "../src/lib/hub-store";
import type { Contest, SafeUser, Team } from "../src/lib/types";

async function main() {
  process.env.ARENA_NAMESPACE = `arena:qa:hub:${randomUUID()}`;
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.GPU_WORKSPACE_PUBLIC_URL = "https://qa.example.test";
  process.env.RUNPOD_HUB_IMAGE =
    "nguyenlong26/olpai-workspace@sha256:" + "f".repeat(64);
  const originalFetch = globalThis.fetch;
  type Pod = {
    id: string;
    name: string;
    imageName: string;
    desiredStatus: string;
    costPerHr: number;
  };
  const pods: Pod[] = [],
    environments = new Map<string, Record<string, string>>();
  let creates = 0,
    providerControls = 0,
    identityMode = "team-hub";
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("api.runpod.io/v2/catalog/gpus"))
      return json({
        gpus: [
          {
            id: "NVIDIA A40",
            name: "A40",
            memory: 48,
            price: { secure: 0.59, community: 0.59 },
          },
        ],
      });
    if (url.includes("api.runpod.io/graphql")) {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("ArenaCreate")) {
        creates++;
        const v = body.variables.input,
          pod = {
            id: `fakehub${creates}abc`,
            name: v.name,
            imageName: v.imageName,
            desiredStatus: "RUNNING",
            costPerHr: 0.59,
          };
        environments.set(
          pod.id,
          Object.fromEntries(
            v.env.map((e: { key: string; value: string }) => [e.key, e.value]),
          ),
        );
        assert.equal(environments.get(pod.id)?.ARENA_JUPYTER_MODE, "team-hub");
        assert.equal(environments.get(pod.id)?.JUPYTER_TOKEN, undefined);
        pods.push(pod);
        return json({ data: { podFindAndDeployOnDemand: pod } });
      }
      if (/ArenaPods|ArenaInspect/.test(body.query))
        return json({ data: { myself: { pods } } });
      providerControls++;
      throw new Error("QA must not perform provider lifecycle actions");
    }
    if (url.includes(".proxy.runpod.net")) {
      const podId = new URL(url).hostname.split("-")[0],
        env = environments.get(podId);
      if (url.endsWith("/api/status")) return json({ status: "ok" });
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer " + env?.ARENA_AGENT_TOKEN,
      );
      if (url.includes("/identity?"))
        return json({
          workspaceId: env?.ARENA_WORKSPACE_ID,
          podId,
          services: "jupyter",
          jupyterMode: identityMode,
          hubProtocol: 1,
          challenge: new URL(url).searchParams.get("challenge"),
        });
      if (url.endsWith("/health"))
        return json({
          jupyter: true,
          hubReady: true,
          hubProtocol: 1,
          llm: false,
          publicReady: true,
          privateReady: false,
          stage: "QA",
        });
      throw new Error("Unexpected fake Pod route");
    }
    return originalFetch(input, init);
  };
  const now = await serverNow();
  const actor = (name: string, admin = false): SafeUser => ({
    id: randomUUID(),
    username: name,
    name,
    admin,
    teamId: null,
    createdAt: now,
  });
  const admin = actor("hub-admin", true),
    members = [actor("A"), actor("B"), actor("C"), actor("D")];
  const teams = members.map((m): Team => {
    const id = randomUUID();
    m.teamId = id;
    return {
      id,
      name: `Team ${m.name}`,
      captainId: m.id,
      members: [m.id],
      inviteCode: randomUUID(),
      createdAt: now,
    };
  });
  const contest = (): Contest => ({
    id: randomUUID(),
    roundId: randomUUID(),
    title: "Hub QA",
    startAt: now - 1000,
    forcedEndAt: null,
    publicSeconds: 18000,
    privateSeconds: 3600,
    publicLimit: 20,
    privateLimit: 5,
    createdAt: now,
  });
  const c = contest(),
    c2 = contest();
  const template: WorkspaceTemplate = {
    ...defaultTemplate,
    id: randomUUID(),
    name: "Hub QA",
    services: "jupyter",
    jupyterMode: "team-hub",
    imageName: process.env.RUNPOD_HUB_IMAGE,
    maxTeamServers: 7,
  };
  try {
    await db().set(key("admin"), admin.id);
    for (const user of [admin, ...members]) {
      const { admin: _a, ...safe } = user;
      await db().set(key(`user:${user.id}`), {
        ...safe,
        password: "unused-qa-hash",
      });
    }
    for (const team of teams)
      await db().hset(key("teams"), { [team.id]: team });
    for (const round of [c, c2]) {
      await db().set(key(`round:${round.roundId}`), round);
      await db().hset(
        key(`registrations:${round.roundId}`),
        Object.fromEntries(
          members.map((m) => [
            m.id,
            { userId: m.id, status: "approved", registeredAt: now },
          ]),
        ),
      );
    }
    await saveCredential(admin, "fake-runpod-key-never-used-externally");
    await saveTemplate(template, admin.id);
    const requestId = randomUUID(),
      options = {
        scope: "all" as const,
        services: "jupyter" as const,
        loadDataset: false,
        requestId,
        teamIds: teams.slice(0, 3).map((t) => t.id),
      };
    const allocated = await Promise.all(
      Array.from({ length: 4 }, () =>
        deployWorkspace(admin, null, c.roundId!, template.id, 1, options),
      ),
    );
    assert.equal(new Set(allocated.map((w) => w.id)).size, 1);
    assert.equal(creates, 1);
    const id = allocated[0].id;
    await syncWorkspace(admin, id);
    assert.equal((await workspaceState(members[3])).workspaces.length, 0);
    await assert.rejects(launchNotebook(members[3], id));
    await changeHubTeam(admin, id, teams[3].id, "grant", randomUUID());
    const starts = await Promise.all(
      Array.from({ length: 4 }, () =>
        changeHubServer(members[0], id, "start", randomUUID()),
      ),
    );
    assert.equal(new Set(starts.map((v) => v.revision)).size, 1);
    assert.equal(creates, 1);
    await assert.rejects(authorizeHub(members[1], id, randomBytes(32).toString("base64url")), /đã dừng/);
    await changeHubServer(members[1], id, "start", randomUUID());
    let w = await getWorkspace(id);
    const auth = "Bearer " + decryptSecret(w.secret);
    const report = {
      runId: c.id,
      hubReady: true,
      resources: { availableRAMGiB: 40, freeDiskGiB: 80 },
      notebooks: Object.values(w.hubTeams!).map((n) => ({
        teamId: n.teamId,
        revision: n.revision,
        state: "ready" as const,
        publicReady: true,
        privateReady: false,
      })),
    };
    await receiveHubReport(id, auth, {
      ...report,
      notebooks: report.notebooks.map(n => ({ ...n, state: "error" as const, error: "Workspace preparation failed" })),
    });
    await assert.rejects(authorizeHub(members[0], id, randomBytes(32).toString("base64url")), /Workspace preparation failed/);
    await receiveHubReport(id, auth, {
      ...report,
      notebooks: report.notebooks.map(n => ({ ...n, state: "waiting-resource" as const })),
    });
    assert.deepEqual(await authorizeHub(members[0], id, randomBytes(32).toString("base64url")), { pending: true, state: "waiting-resource" });
    await receiveHubReport(id, auth, report);
    const studentState = await workspaceState(members[0]);
    assert.equal(studentState.workspaces[0].hub?.teams.length, 1);
    assert.equal(
      studentState.workspaces[0].hub?.teams[0].server?.state,
      "ready",
    );
    assert.equal(
      JSON.stringify(studentState).includes(decryptSecret(w.secret)),
      false,
    );
    await assert.rejects(
      changeHubServer(members[0], id, "start", randomUUID(), teams[1].id),
    );
    const state = randomBytes(32).toString("base64url"),
      ticket = await authorizeHub(members[0], id, state);
    assert.ok(ticket.url);
    const code = new URL(ticket.url!).searchParams.get("ticket")!;
    await assert.rejects(redeemHub(id, auth, code, "wrong-state"));
    assert.equal((await redeemHub(id, auth, code, state)).teamId, teams[0].id);
    await assert.rejects(redeemHub(id, auth, code, state));
    await Promise.all(
      members.slice(0, 2).map((m) => gpuTurn(w, c, m, "start", randomUUID())),
    );
    assert.equal(
      (await readGpuTurns(id, c.id)).filter((t) => t.state === "using").length,
      2,
    );
    const releaseId = randomUUID();
    await Promise.all(
      Array.from({ length: 3 }, () =>
        gpuTurn(w, c, members[0], "release", releaseId),
      ),
    );
    assert.equal((await readGpuTurns(id, c.id)).length, 1);
    const beforeReset = { ...c };
    const oldState = randomBytes(32).toString("base64url");
    const oldTicket = await authorizeHub(members[1], id, oldState);
    assert.ok(oldTicket.url);
    c.chatEpoch = 1; // reset while keeping leaderboard/run ID
    await db().set(key(`round:${c.roundId}`), c);
    await assert.rejects(
      redeemHub(
        id,
        auth,
        new URL(oldTicket.url!).searchParams.get("ticket")!,
        oldState,
      ),
    );
    await assert.rejects(
      gpuTurn(w, beforeReset, members[1], "start", randomUUID()),
    );
    assert.equal(
      (await workspaceState(members[1])).workspaces[0].hub?.turns.length,
      0,
    );
    await changeHubTeam(
      admin,
      id,
      teams[0].id,
      "revoke",
      randomUUID(),
      w.hubTeams![teams[0].id].revision,
    );
    await assert.rejects(launchNotebook(members[0], id));
    await assert.rejects(gpuTurn(w, c, members[0], "start", randomUUID()));
    const prepared = await deployWorkspace(
      admin,
      null,
      c2.roundId!,
      template.id,
      1,
      { ...options, requestId: randomUUID(), manual: true },
    );
    assert.equal(creates, 1);
    assert.equal(prepared.estimatedUsd, 0);
    w = await getWorkspace(prepared.id);
    assert.equal(
      (await agentManifest(w.id, "Bearer " + decryptSecret(w.secret))).active,
      false,
    );
    const config = await manualConfiguration(admin, w.id);
    assert.equal(config.environment.ARENA_JUPYTER_MODE, "team-hub");
    const podId = "manualhubabc";
    pods.push({
      id: podId,
      name: config.podName,
      imageName: config.imageName,
      desiredStatus: "RUNNING",
      costPerHr: 0.59,
    });
    environments.set(podId, config.environment);
    identityMode = "single";
    await assert.rejects(controlManual(admin, w.id, "attach", podId));
    identityMode = "team-hub";
    await controlManual(admin, w.id, "inspect", podId);
    assert.equal(
      (await agentManifest(w.id, "Bearer " + decryptSecret(w.secret))).active,
      false,
    );
    await controlManual(admin, w.id, "attach", podId);
    await controlManual(admin, w.id, "attach", podId);
    assert.equal(
      (await agentManifest(w.id, "Bearer " + decryptSecret(w.secret))).active,
      true,
    );
    await controlManual(admin, w.id, "detach");
    assert.equal(
      (await agentManifest(w.id, "Bearer " + decryptSecret(w.secret))).active,
      false,
    );
    assert.equal(providerControls, 0);
    const updated = { ...c, id: randomUUID() };
    await db().set(key(`round:${c.roundId}`), updated);
    await assert.rejects(receiveHubReport(id, auth, report));
    assert.equal(
      (await workspaceState(members[1])).workspaces[0].hub?.turns.length,
      0,
    );
    console.log(
      "Hub QA passed: concurrent allocation/start, team isolation, SSO replay, multi-team GPU turns, manual identity/bind/detach and reset fencing. No real Pod created.",
    );
  } finally {
    globalThis.fetch = originalFetch;
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
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Hub QA failed");
  process.exitCode = 1;
});
