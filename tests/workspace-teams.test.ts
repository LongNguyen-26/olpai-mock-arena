import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedTeamOptions } from "../src/lib/workspace-teams";
import { capacityRejected } from "../src/lib/workspace-domain";
import type { Team, Registration } from "../src/lib/types";

test("GPU team options include only current teams with approved members of the selected round", () => {
  const teams = [
    { id: "one", name: "Đội một", members: ["approved", "pending"] },
    { id: "two", name: "Đội hai", members: ["pending"] },
    { id: "three", name: "Đội ba", members: ["rejected"] },
    { id: "empty", name: "Đội rỗng", members: [] },
  ] as Team[];
  const registrations = [
    { userId: "approved", status: "approved" },
    { userId: "pending", status: "pending" },
    { userId: "rejected", status: "rejected" },
    { userId: "former-member", status: "approved" },
  ] as Registration[];
  assert.deepEqual(approvedTeamOptions(teams, registrations), [
    { id: "one", name: "Đội một", members: 2, approvedMembers: 1 },
  ]);
  assert.deepEqual(approvedTeamOptions(teams, []), []);
  assert.equal(
    approvedTeamOptions(teams, [
      { userId: "pending", status: "approved", registeredAt: 0 },
    ]).length,
    2,
  );
});

test("only confirmed capacity rejection offers retry; unknown ACK and host faults do not", () => {
  const rejected = {
    status: "failed" as const,
    podId: null,
    error: null,
    provisionFailure: "capacity" as const,
  };
  assert.equal(capacityRejected(rejected), true);
  assert.equal(capacityRejected({ ...rejected, status: "reconciling" }), false);
  assert.equal(
    capacityRejected({ ...rejected, podId: "confirmed-pod" }),
    false,
  );
  assert.equal(
    capacityRejected({
      ...rejected,
      provisionFailure: undefined,
      error: "GPU requires reset",
    }),
    false,
  );
});
