/** Real Redis in a fresh namespace; no production writes, Blob writes or GPU calls. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db, key, serverNow } from "../src/lib/db";
import { control, getContest, snapshot } from "../src/lib/rounds";
import { hashPassword } from "../src/lib/auth";
import { SUBMIT_SCRIPT } from "../src/lib/arena";
import { CONTROL_ROUND_SCRIPT } from "../src/lib/round-control";
import { ROUND_POLICY_LUA } from "../src/lib/round-policy-lua";
import {
  applyPrivateTransition,
  chatbotAllowed,
  phaseOf,
  submissionAccess,
} from "../src/lib/domain";
import type {
  Contest,
  ContestPackage,
  SafeUser,
  Submission,
} from "../src/lib/types";

async function main() {
  const namespace = `arena:qa:round-access-${randomUUID()}`;
  process.env.ARENA_NAMESPACE = namespace;
  const rid = randomUUID(),
    adminId = randomUUID(),
    uid = randomUUID(),
    tid = randomUUID();
  const now = await serverNow();
  const initial: Contest = {
    id: randomUUID(),
    roundId: rid,
    packageId: "qa-only",
    title: "QA · Điều khiển vòng luyện",
    startAt: now - 10000,
    privateAt: now + 3600000,
    forcedEndAt: null,
    publicSeconds: 3600,
    privateSeconds: 3600,
    publicLimit: 20,
    privateLimit: 5,
    createdAt: now,
  };
  const member: SafeUser = {
    id: uid,
    username: "round-student@example.test",
    name: "Thí sinh QA",
    teamId: tid,
    createdAt: now,
    admin: false,
  };
  const admin: SafeUser = {
    id: adminId,
    username: "qa_round_admin",
    name: "Quản trị QA",
    teamId: null,
    createdAt: now,
    admin: true,
  };
  const pkg: ContestPackage = {
    version: "qa-only",
    title: "Bộ đề QA nội bộ",
    statement: "Nội dung QA nội bộ.",
    tasks: [
      {
        id: "1",
        title: "Tác vụ QA",
        content: "Nội dung kiểm tra giao diện, không phải đề thi.",
        columns: ["id", "prediction"],
      },
    ],
    assets: [],
    judges: {
      "1": { public: "unused", private: "unused" },
      "2": { public: "unused", private: "unused" },
    },
    importedAt: now,
  };
  const password = "Arena-Round-QA-Only-2026!";
  const hashed = await hashPassword(password);
  let keep = false;
  try {
    await db()
      .multi()
      .set(key(`round:${rid}`), initial)
      .zadd(key("rounds"), { score: now, member: rid })
      .set(key("admin"), adminId)
      .set(key(`user:${uid}`), {
        ...member,
        admin: undefined,
        password: hashed,
      })
      .set(key(`user:${adminId}`), {
        ...admin,
        admin: undefined,
        password: hashed,
      })
      .set(key(`username:${admin.username}`), adminId)
      .set(key(`username:${member.username}`), uid)
      .hset(key("teams"), {
        [tid]: {
          id: tid,
          name: "Đội QA",
          captainId: uid,
          members: [uid],
          inviteCode: "qa-only",
          createdAt: now,
        },
      })
      .hset(key(`registrations:${rid}`), {
        [uid]: { userId: uid, status: "approved", registeredAt: now },
      })
      .set(key("package:qa-only"), pkg)
      .hset(key("packages"), { "qa-only": "Bộ đề QA nội bộ" })
      .exec();
    async function change(
      action: string,
      values: Record<string, unknown> = {},
    ) {
      const c = await getContest(rid);
      const value = {
        ...values,
        action,
        runId: c.id,
        revision: c.revision ?? 0,
        requestId: randomUUID(),
      };
      await control(action, value, rid);
      return value;
    }
    async function submit(split: "public" | "private", nonce = randomUUID()) {
      const s: Submission = {
        id: randomUUID(),
        runId: initial.id,
        teamId: tid,
        userId: uid,
        task: "1",
        split,
        filename: "qa.csv",
        createdAt: now,
        score: 50,
        secondary: 0,
        bytes: 0,
        sha256: "qa-only",
        path: "",
        note: "",
        status: "accepted",
      };
      return db().eval<unknown[], string>(
        SUBMIT_SCRIPT,
        [
          key(`round:${rid}`),
          key(`quota:${initial.id}:${tid}:1:${split}`),
          key(`submissions:${initial.id}`),
          key(`qa-request:${nonce}`),
          key(`user:${uid}`),
          key(`registrations:${rid}`),
          key("admin"),
          key("admins"),
        ],
        [initial.id, split, JSON.stringify(s), tid],
      );
    }
    // Compare TS and actual Lua at exact boundaries, including cjson-omitted nulls.
    const base = {
      ...initial,
      startAt: 1000,
      privateAt: 2000,
      publicSeconds: 1,
      privateSeconds: 1,
    };
    const sources: Contest[] = [
      base,
      { ...base, unlimited: true, privateAt: null },
      { ...base, timingVersion: 1, endAt: null },
      { ...base, forcedEndAt: 1700 },
      {
        ...base,
        practice: { startAt: 4000, endAt: 6000 },
        chatbotAllowed: true,
        privateStartedAt: 2000,
      },
      ...[true, false].flatMap((lockPublic) =>
        [true, false].map((revokeChatbot) => ({
          ...base,
          privatePolicy: { lockPublic, revokeChatbot },
        })),
      ),
    ];
    const cases = sources.flatMap((c) =>
      [999, 1000, 1999, 2000, 2999, 3000, 4500, 6000].map((time) => ({
        c,
        time,
      })),
    );
    const actual = await db().eval<
      unknown[],
      {
        phase: string;
        chat: boolean;
        public: boolean;
        private: boolean;
        revision: number;
      }[]
    >(
      ROUND_POLICY_LUA +
        `
local out={};for _,v in ipairs(cjson.decode(ARGV[1])) do local c=v.c;arena_transition(c,v.time);table.insert(out,{phase=arena_phase(c,v.time),chat=arena_chat(c,v.time),public=arena_submit(c,v.time,'public'),private=arena_submit(c,v.time,'private'),revision=c.revision or 0}) end;return cjson.encode(out)`,
      [],
      [JSON.stringify(cases)],
    );
    cases.forEach(({ c, time }, i) =>
      assert.deepEqual(actual[i], {
        phase: phaseOf(c, time),
        chat: chatbotAllowed(c, time),
        public: submissionAccess(c, time, "public").accepting,
        private: submissionAccess(c, time, "private").accepting,
        revision: applyPrivateTransition(c, time).revision ?? 0,
      }),
    );
    console.log(
      `PASS: ${cases.length} TS/Lua boundary fixtures agree on phase, submission, chatbot and transition revision.`,
    );
    assert.notEqual(await submit("public"), "closed");
    assert.equal(await submit("private"), "closed");
    assert.equal(await db().eval(CONTROL_ROUND_SCRIPT,
      [key(`round:${rid}`), key("qa-expired-timing")],
      ["qa-expired-timing", initial.id, 0, "public", JSON.stringify({ ...initial, timingVersion: 1, privateAt: (await serverNow()) - 1, endAt: now + 7200000, revision: 1 }), "timing"]), "conflict");
    const granted = await change("timing", {
      privateAt: initial.privateAt,
      endAt: now + 7200000,
    });
    await control("timing", granted, rid); // same successful request is acknowledged again
    const current = await getContest(rid);
    const outcomes = await Promise.allSettled(
      [true, false].map((visible) =>
        control(
          "submission-access",
          {
            action: "submission-access",
            runId: current.id,
            revision: current.revision ?? 0,
            requestId: randomUUID(),
            split: "public",
            visible,
            enabled: true,
          },
          rid,
        ),
      ),
    );
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    await change("submission-access", {
      split: "public",
      visible: false,
      enabled: true,
    });
    assert.equal(await submit("public"), "closed");
    await change("submission-access", {
      split: "public",
      visible: true,
      enabled: true,
    });
    const nonce = randomUUID();
    const duplicates = await Promise.all([
      submit("public", nonce),
      submit("public", nonce),
    ]);
    assert.equal(duplicates[0], duplicates[1]);
    await change("open-private", {
      lockPublic: false,
      revokeChatbot: false,
      endAt: now + 7200000,
    });
    assert.notEqual(await submit("public"), "closed");
    assert.notEqual(await submit("private"), "closed");
    const entered = await getContest(rid);
    const marker = entered.privateStartedAt;
    for (const visible of [false, true])
      await change("submission-access", {
        split: "private",
        visible,
        enabled: true,
      });
    assert.equal((await getContest(rid)).privateStartedAt, marker);
    const race = await Promise.all([
      submit("private"),
      change("submission-access", {
        split: "private",
        visible: true,
        enabled: false,
      }),
    ]);
    assert.ok(typeof race[0] === "string");
    assert.equal(await submit("private"), "closed");
    const before = await snapshot(member, rid);
    await control("finish", {}, rid);
    await change("practice-open", {
      endAt: null,
      publicVisible: true,
      privateVisible: true,
      chatbotEnabled: true,
      chatbotUntil: null,
      notebookEnabled: true,
    });
    assert.notEqual(await submit("private"), "closed");
    assert.notEqual(await submit("public"), "closed");
    const practice = await snapshot(member, rid);
    assert.equal(practice.contest!.id, before.contest!.id);
    assert.equal(practice.phase, "practice");
    assert.equal(practice.submissions.length, before.submissions.length + 2);
    assert.ok(
      practice.leaderboard.public.length &&
        practice.leaderboard.private!.length,
    );
    await change("grant-quota", { split: "private", amount: 2 });
    assert.equal((await getContest(rid)).privateLimit, 7);
    await change("practice-close");
    assert.equal(await submit("public"), "closed");
    assert.equal(await submit("private"), "closed");
    // Future private entry must reject a form captured in the public stage.
    const preBoundary = { ...initial, privateAt: (await serverNow()) - 1 };
    await db().set(key(`round:${rid}`), preBoundary);
    await assert.rejects(
      () =>
        control(
          "submission-access",
          {
            action: "submission-access",
            runId: initial.id,
            revision: 0,
            requestId: randomUUID(),
            split: "public",
            visible: false,
            enabled: true,
          },
          rid,
        ),
      /vừa được cập nhật/,
    );
    console.log(
      "PASS: atomic controls, stale form/concurrent admin guards, idempotency, hidden/closed Lua submission gates, both splits and cumulative practice quotas/results.",
    );
    if (process.argv.includes("--keep")) {
      await db().set(key(`round:${rid}`), {
        ...initial,
        startAt: null,
        privateAt: null,
      });
      await mkdir(".local", { recursive: true });
      await writeFile(
        ".local/round-access-qa.json",
        JSON.stringify({
          namespace,
          roundId: rid,
          admin: admin.username,
          member: member.username,
          password,
        }),
      );
      console.log(
        "QA browser fixture saved locally; no production records or GPU changed.",
      );
      keep = true;
    }
  } finally {
    if (!keep) {
      let cursor = "0";
      const keys: string[] = [];
      do {
        const page = await db().scan(cursor, { match: key("*"), count: 100 });
        cursor = String(page[0]);
        keys.push(...page[1]);
      } while (cursor !== "0");
      for (let i = 0; i < keys.length; i += 100)
        await db().del(...keys.slice(i, i + 100));
    }
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
