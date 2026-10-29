/** Isolated real Redis; Runpod/model are stubs. Never creates a billable Pod. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { db, key } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { adminRoster, deleteRosterEntry } from "../src/lib/admin-roster";
import { workspaceTeams } from "../src/lib/workspace-teams";
import { defaultTemplate, capacityRejected } from "../src/lib/workspace-domain";
import {
  saveCredential,
  saveTemplate,
  deployWorkspace,
  retryWorkspace,
  getWorkspace,
  controlWorkspace,
  syncWorkspace,
} from "../src/lib/workspaces";
import { registerRound } from "../src/lib/rounds";
import { TEAM_SCRIPT } from "../src/lib/teams";
import { SUBMIT_SCRIPT } from "../src/lib/arena";
import { readTemplates } from "../src/lib/workspace-templates";
import type { SafeUser, User, Team, Contest } from "../src/lib/types";

async function main() {
  process.env.ARENA_NAMESPACE = `arena:qa:gpu:${randomUUID()}`;
  process.env.GPU_WORKSPACE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.GPU_WORKSPACE_PUBLIC_URL = "https://qa.example.test";
  const originalFetch = globalThis.fetch;
  let kept = false;
  const password = "Arena-GPU-QA-Only-2026!",
    hashed = await hashPassword(password),
    now = Date.now();
  const makeUser = async (
    username: string,
    name: string,
    teamId: string | null = null,
    admin = false,
  ): Promise<SafeUser> => {
    const user: User = {
      id: randomUUID(),
      name,
      username,
      password: hashed,
      teamId,
      createdAt: now,
    };
    await db().set(key(`user:${user.id}`), user);
    await db().set(key(`username:${username}`), user.id);
    const { password: _p, ...safe } = user;
    return { ...safe, admin };
  };
  let mode: "capacity" | "ok" | "timeout" = "capacity",
    creates = 0;
  let listGate: Promise<void> | undefined;
  let notifyList: (() => void) | undefined;
  const pods: {
    id: string;
    name: string;
    desiredStatus: string;
    costPerHr: number;
  }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v2/catalog/gpus"))
      return Response.json({
        gpus: [
          {
            id: "NVIDIA A40",
            name: "A40",
            memory: 48,
            price: { secure: 0.7, community: 0.59 },
          },
        ],
      });
    if (url === "https://api.runpod.io/graphql") {
      const q = JSON.parse(String(init?.body));
      if (q.query.includes("ArenaCreate")) {
        creates++;
        if (mode === "capacity")
          return Response.json({
            errors: [
              {
                message: "No instances available",
                extensions: { code: "SUPPLY_CONSTRAINT" },
              },
            ],
          });
        const pod = {
          id: `qacapacity${creates}`,
          name: q.variables.input.name,
          desiredStatus: "RUNNING",
          costPerHr: 0.7,
        };
        pods.push(pod);
        if (mode === "timeout") throw new Error("QA lost ACK");
        return Response.json({ data: { podFindAndDeployOnDemand: pod } });
      }
      if (q.query.includes("ArenaPods")) {
        if (listGate) {
          notifyList?.();
          await listGate;
        }
        return Response.json({ data: { myself: { pods } } });
      }
      if (q.query.includes("ArenaTerminate")) {
        const i = pods.findIndex((p) => p.id === q.variables.input.podId);
        if (i >= 0) pods.splice(i, 1);
        return Response.json({ data: { podTerminate: null } });
      }
    }
    if (url.includes(".proxy.runpod.net"))
      return Response.json({
        llm: true,
        jupyter: true,
        chatQueueProtocol: 1,
        stage: "QA fixture",
        publicReady: true,
      });
    return originalFetch(input, init);
  };
  try {
    const admin = await makeUser("qa_ops_admin", "Admin QA", null, true),
      other = await makeUser("qa_ops_admin2", "Admin QA 2", null, true);
    await db().set(key("admin"), admin.id);
    await db().sadd(key("admins"), other.id);
    const teamId = randomUUID(),
      pendingTeamId = randomUUID();
    const member = await makeUser("qa_ops_member", "Thí sinh đã duyệt", teamId),
      pending = await makeUser(
        "qa_ops_pending",
        "Thí sinh chờ duyệt",
        pendingTeamId,
      );
    const teams: Team[] = [
      {
        id: teamId,
        name: "Đội QA đã duyệt",
        captainId: member.id,
        members: [member.id],
        inviteCode: "qaapproved",
        createdAt: now,
      },
      {
        id: pendingTeamId,
        name: "Đội QA chờ duyệt",
        captainId: pending.id,
        members: [pending.id],
        inviteCode: "qapending",
        createdAt: now,
      },
    ];
    await db().hset(
      key("teams"),
      Object.fromEntries(teams.map((t) => [t.id, t])),
    );
    const c: Contest = {
      id: randomUUID(),
      roundId: randomUUID(),
      title: "Vòng QA đã duyệt",
      startAt: now - 1000,
      forcedEndAt: null,
      unlimited: true,
      publicSeconds: 18000,
      privateSeconds: 3600,
      publicLimit: 20,
      privateLimit: 5,
      autoApprove: false,
      createdAt: now,
    };
    const c2 = {
      ...c,
      id: randomUUID(),
      roundId: randomUUID(),
      title: "Vòng QA thứ hai",
    };
    for (const round of [c, c2]) {
      await db().set(key(`round:${round.roundId}`), round);
      await db().zadd(key("rounds"), { score: now, member: round.roundId! });
    }
    await db().hset(key(`registrations:${c.roundId}`), {
      [member.id]: { userId: member.id, status: "approved", registeredAt: now },
      [pending.id]: {
        userId: pending.id,
        status: "pending",
        registeredAt: now,
      },
    });
    await db().hset(key(`registrations:${c2.roundId}`), {
      [pending.id]: {
        userId: pending.id,
        status: "approved",
        registeredAt: now,
      },
    });
    assert.deepEqual(
      (await workspaceTeams(admin, c.roundId!)).teams.map((t) => t.id),
      [teamId],
    );
    assert.deepEqual(
      (await workspaceTeams(admin, c2.roundId!)).teams.map((t) => t.id),
      [pendingTeamId],
    );
    await assert.rejects(() => workspaceTeams(member, c.roundId!), /quản trị/);
    await saveCredential(admin, "qa-fake-key");
    const template = {
      ...defaultTemplate,
      imageName: "nguyenlong26/olpai-workspace:qa-capacity",
    };
    await saveTemplate(template, admin.id);
    const deploy = () =>
      deployWorkspace(admin, teamId, c.roundId!, template.id, 0.8, {
        loadDataset: false,
        requestId: randomUUID(),
      });
    await assert.rejects(
      () =>
        deployWorkspace(admin, pendingTeamId, c.roundId!, template.id, 0.8, {
          loadDataset: false,
        }),
      /được duyệt/,
    );
    assert.equal(creates, 0);
    const failed = await deploy();
    assert.ok(capacityRejected(failed));
    assert.equal(failed.maxHourlyUsd, 0.8);
    let releaseList!: () => void;
    const enteredList = new Promise<void>((resolve) => {
      notifyList = resolve;
    });
    listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const syncing = syncWorkspace(admin, failed.id);
    await enteredList;
    await assert.rejects(
      () => retryWorkspace(admin, failed.id, randomUUID()),
      /đang được xử lý/,
    );
    releaseList();
    listGate = undefined;
    notifyList = undefined;
    await syncing;
    const latest = (await readTemplates(admin.id))[template.id];
    await saveTemplate({ ...latest, minRAMPerGPU: 96 }, admin.id, {
      overwrite: true,
      expectedRevision: latest.revision,
    });
    await assert.rejects(
      () => retryWorkspace(admin, failed.id, failed.id),
      /request ID mới/,
    );
    assert.equal(
      await db().exists(key(`gpu:active:v2:team:${teamId}:${c.roundId}:llm`)),
      0,
    );
    await assert.rejects(
      () => retryWorkspace(other, failed.id, randomUUID()),
      /khác/,
    );
    mode = "ok";
    const requestId = randomUUID();
    const concurrent = await Promise.allSettled([
      retryWorkspace(admin, failed.id, requestId),
      retryWorkspace(admin, failed.id, requestId),
    ]);
    assert.ok(concurrent.some((r) => r.status === "fulfilled"));
    assert.equal(creates, 2);
    const child = await retryWorkspace(admin, failed.id, requestId);
    assert.equal(
      child.template.minRAMPerGPU,
      failed.template.minRAMPerGPU,
      "retry must preserve original resource snapshot",
    );
    assert.equal(child.id, requestId);
    assert.equal(creates, 2);
    assert.equal((await getWorkspace(failed.id)).status, "terminated");
    await assert.rejects(
      () => retryWorkspace(admin, failed.id, randomUUID()),
      /đã được thử lại/,
    );
    await controlWorkspace(admin, child.id, "terminate");
    mode = "capacity";
    const parent = await deploy();
    mode = "timeout";
    const lostId = randomUUID();
    const lost = await retryWorkspace(admin, parent.id, lostId);
    assert.equal(lost.status, "reconciling");
    const before = creates;
    assert.equal((await retryWorkspace(admin, parent.id, lostId)).id, lostId);
    assert.equal(creates, before);
    await assert.rejects(
      () => retryWorkspace(admin, lost.id, randomUUID()),
      /mất xác nhận/,
    );
    await syncWorkspace(admin, lost.id);
    await controlWorkspace(admin, lost.id, "terminate");
    mode = "capacity";
    const detected = await deploy();
    pods.push({
      id: "qarecoveredAck",
      name: (await getWorkspace(detected.id)).podName,
      desiredStatus: "RUNNING",
      costPerHr: 0.7,
    });
    await assert.rejects(
      () => retryWorkspace(admin, detected.id, randomUUID()),
      /Đã tìm thấy Pod/,
    );
    assert.equal((await getWorkspace(detected.id)).podId, "qarecoveredAck");
    await controlWorkspace(admin, detected.id, "terminate");
    console.log(
      "PASS capacity/teams: selected round, server eligibility, concurrent retry, idempotency, lost ACK and provider reconciliation.",
    );
    const deleteTeamId = randomUUID();
    const captain = await makeUser(
        "qa_ops_delete",
        "Thí sinh QA cần xóa",
        deleteTeamId,
      ),
      successor = await makeUser(
        "qa_ops_survivor",
        "Thành viên còn lại",
        deleteTeamId,
      );
    const dt: Team = {
      id: deleteTeamId,
      name: "Đội QA cần xóa",
      members: [captain.id, successor.id],
      captainId: captain.id,
      inviteCode: "qadelete",
      createdAt: now,
    };
    await db().hset(key("teams"), { [dt.id]: dt });
    await db().set(key(`code:${dt.inviteCode}`), dt.id);
    await db().hset(key(`registrations:${c.roundId}`), {
      [captain.id]: {
        userId: captain.id,
        status: "approved",
        registeredAt: now,
      },
    });
    await db().hset(key(`submissions:${c.id}`), {
      "qa-history": { userId: captain.id, teamId: dt.id, status: "accepted" },
    });
    const roster = await adminRoster(admin);
    assert.ok(!JSON.stringify(roster).includes(hashed));
    assert.ok(!roster.contestants.some((u) => u.id === other.id));
    await assert.rejects(
      () => deleteRosterEntry(member, "team", dt.id),
      /quản trị/,
    );
    await assert.rejects(
      () => deleteRosterEntry(admin, "contestant", other.id),
      /quản trị/,
    );
    await deleteRosterEntry(admin, "contestant", captain.id);
    assert.equal(await db().exists(key(`user:${captain.id}`)), 0);
    assert.equal(await db().exists(key(`username:${captain.username}`)), 0);
    const remaining = await db().hget<Team>(key("teams"), dt.id);
    assert.deepEqual(remaining?.members, [successor.id]);
    assert.equal(remaining?.captainId, successor.id);
    assert.equal(
      await db().hget(key(`registrations:${c.roundId}`), captain.id),
      null,
    );
    await assert.rejects(() => registerRound(captain, c.roundId!), /Tài khoản/);
    assert.equal(
      await db().eval(
        TEAM_SCRIPT,
        [key(`user:${captain.id}`), key("teams"), key("code:unused")],
        ["create", randomUUID(), "{}"],
      ),
      "missing",
    );
    assert.equal(
      await db().eval(
        SUBMIT_SCRIPT,
        [
          key(`round:${c.roundId}`),
          key("quota:test"),
          key(`submissions:${c.id}`),
          key("request:gone"),
          key(`user:${captain.id}`),
          key(`registrations:${c.roundId}`),
          key("admin"),
          key("admins"),
        ],
        [c.id, "public", "{}", dt.id],
      ),
      "role",
    );
    await deleteRosterEntry(admin, "team", dt.id);
    assert.equal(await db().hget(key("teams"), dt.id), null);
    assert.equal(
      (await db().get<User>(key(`user:${successor.id}`)))?.teamId ?? null,
      null,
    );
    assert.equal(await db().exists(key(`code:${dt.inviteCode}`)), 0);
    assert.ok(await db().hget(key(`submissions:${c.id}`), "qa-history"));
    await deleteRosterEntry(admin, "team", dt.id);
    console.log(
      "PASS roster: role protection, captain transfer, login record/index removal, registration revocation, stale actions denied, team unlink and retained submissions.",
    );
    if (process.argv.includes("--keep")) {
      const uiTeamId = randomUUID(),
        uiUser = await makeUser(
          "qa_ops_ui_delete",
          "Thí sinh UI cần xóa",
          uiTeamId,
        );
      await db().hset(key("teams"), {
        [uiTeamId]: {
          ...dt,
          id: uiTeamId,
          name: "Đội UI cần xóa",
          captainId: uiUser.id,
          members: [uiUser.id],
          inviteCode: "qauidelete",
        },
      });
      mode = "capacity";
      const capacity = await deploy();
      await writeFile(
        ".local/gpu-qa.json",
        JSON.stringify({
          namespace: process.env.ARENA_NAMESPACE,
          encryptionKey: process.env.GPU_WORKSPACE_ENCRYPTION_KEY,
          roundId: c.roundId,
          secondRoundId: c2.roundId,
          workspaceId: capacity.id,
          admin: admin.username,
          member: member.username,
          password,
          approvedTeamId: teamId,
          pendingTeamId,
          deletionUserId: uiUser.id,
          deletionTeamId: uiTeamId,
        }),
      );
      kept = true;
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (!kept) {
      let cursor = "0";
      do {
        const [next, keys] = await db().scan(cursor, {
          match: key("*"),
          count: 100,
        });
        cursor = String(next);
        if (keys.length) {
          assert.ok(
            keys.every((k) => k.startsWith(process.env.ARENA_NAMESPACE! + ":")),
          );
          await db().del(...keys);
        }
      } while (cursor !== "0");
    }
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : "QA failed");
  process.exitCode = 1;
});
