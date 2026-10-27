import test from "node:test";
import assert from "node:assert/strict";
import { snapshot } from "../src/lib/rounds";

test("round discovery counts pending and approved contestants without exposing the roster", async (t) => {
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.fixture.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fixture-only";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined)
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
  });
  const contest = {
    id: "run",
    roundId: "r1",
    title: "Fixture",
    startAt: 1000,
    privateAt: 20000,
    forcedEndAt: 30000,
    publicSeconds: 18,
    privateSeconds: 3,
    publicLimit: 20,
    privateLimit: 5,
    createdAt: 0,
  };
  const roster = {
    u1: { userId: "u1", status: "pending", registeredAt: 0 },
    u2: { userId: "u2", status: "approved", registeredAt: 0 },
    u3: { userId: "u3", status: "rejected", registeredAt: 0 },
    admin: { userId: "admin", status: "approved", registeredAt: 0 },
  };
  const command = (args: string[]) => {
    switch (args[0].toUpperCase()) {
      case "ZRANGE":
        return ["r1", "missing-round"];
      case "TIME":
        return ["2", "0"];
      case "SMEMBERS":
        return [];
      case "MGET":
        return [JSON.stringify(contest), null];
      case "GET":
        return args[1].endsWith(":admin") ? "admin" : null;
      case "HGETALL":
        return args[1].includes(":registrations:")
          ? Object.entries(roster).flatMap(([id, r]) => [id, JSON.stringify(r)])
          : [];
      default:
        throw new Error(`Unexpected fixture command: ${args[0]}`);
    }
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      assert.equal(new URL(String(input)).hostname, "redis.fixture.invalid");
      const body = JSON.parse(String(init?.body));
      const result = Array.isArray(body[0])
        ? body.map((args: string[]) => ({ result: command(args) }))
        : { result: command(body) };
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  const result = await snapshot({
    id: "u1",
    name: "Fixture",
    username: "fixture",
    admin: false,
    teamId: null,
    createdAt: 0,
  });
  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0].registrationCount, 2);
  assert.deepEqual(result.rounds[0].registration, roster.u1);
  assert.equal(result.rounds[0].privateAt, 20000);
  assert.equal(result.rounds[0].forcedEndAt, 30000);
  assert.equal(JSON.stringify(result.rounds).includes('"u2"'), false);
  assert.equal(JSON.stringify(result.rounds).includes('"u3"'), false);
});
