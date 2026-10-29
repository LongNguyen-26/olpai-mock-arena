import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  hubUsername,
  hubImage,
  isTeamHub,
  notebookReport,
  type HubReport,
} from "../src/lib/hub-domain";
import {
  defaultTemplate,
  templateSchema,
  workspaceView,
  type Workspace,
} from "../src/lib/workspace-domain";
import { hubVisible, hubBound } from "../src/lib/hub-store";

test("Hub templates require Jupyter-only and retain legacy defaults", () => {
  const template = {
    ...defaultTemplate,
    imageName: "example/image:tag",
    jupyterMode: "team-hub",
    maxTeamServers: 7,
  };
  assert.equal(templateSchema.safeParse(template).success, false);
  assert.equal(
    templateSchema.safeParse({ ...template, services: "llm" }).success,
    false,
  );
  assert.equal(
    templateSchema.safeParse({ ...template, services: "jupyter" }).success,
    true,
  );
  assert.equal(
    templateSchema.safeParse({
      ...template,
      services: "jupyter",
      maxTeamServers: 0,
    }).success,
    false,
  );
  assert.equal(isTeamHub({}), false);
});
test("Hub usernames fit Unix limits and only immutable Arena images are accepted", () => {
  assert.match(hubUsername(randomUUID()), /^t[a-f0-9]{24}$/);
  assert.ok(hubImage("nguyenlong26/olpai-workspace@sha256:" + "a".repeat(64)));
  assert.equal(hubImage("nguyenlong26/olpai-workspace:latest"), false);
});
test("Hub reports are fenced by run, desired revision and heartbeat freshness", () => {
  const teamId = randomUUID(),
    revision = randomUUID();
  const w = {
    hubTeams: {
      [teamId]: {
        teamId,
        teamName: "A",
        enabled: true,
        desiredState: "running" as const,
        revision,
        updatedAt: 1,
      },
    },
  };
  const report: HubReport = {
    runId: "run",
    observedAt: 100,
    hubReady: true,
    resources: { availableRAMGiB: 8, freeDiskGiB: 50 },
    notebooks: [
      {
        teamId,
        revision,
        state: "ready",
        publicReady: true,
        privateReady: false,
      },
    ],
  };
  assert.equal(notebookReport(w, report, teamId, "run", 100)?.state, "ready");
  assert.equal(notebookReport(w, report, teamId, "old-run", 100), null);
  assert.equal(notebookReport(w, report, teamId, "run", 45200), null);
  w.hubTeams[teamId].revision = randomUUID();
  assert.equal(notebookReport(w, report, teamId, "run", 100), null);
});
test("Hub views exclude the complete team map and do not broaden legacy sharing", () => {
  const w = {
    id: "host",
    jupyterMode: "team-hub",
    hubInitialTeamIds: ["a", "b"],
    hubTeams: { a: { enabled: true }, b: { enabled: false } },
    secret: "agent-secret",
    jupyterSecret: "lab-secret",
    ownerId: "owner",
    status: "provisioning",
    podId: null,
    accruedUsd: 0,
    meterRate: 0,
    meterAt: 0,
  } as unknown as Workspace;
  assert.equal(hubVisible(w, { teamId: "a", admin: false } as never), true);
  assert.equal(hubVisible(w, { teamId: "b", admin: false } as never), false);
  assert.equal(hubVisible(w, { teamId: "c", admin: false } as never), false);
  const serialized = JSON.stringify(workspaceView(w, 1, false));
  for (const field of [
    "agent-secret",
    "lab-secret",
    "hubTeams",
    "hubInitialTeamIds",
  ])
    assert.equal(serialized.includes(field), false);
  assert.equal(hubBound({ ...w, manual: { state: "prepared" } }), false);
  assert.equal(hubBound({ ...w, manual: { state: "bound" } }), true);
});
