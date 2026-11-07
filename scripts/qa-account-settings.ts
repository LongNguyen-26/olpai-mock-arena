/** Disposable local Postgres + mocked Auth/SMTP. No hosted Auth users or real emails.
 * npx tsx --env-file=.local/auth-qa.env scripts/qa-account-settings.ts [--keep]
 */
import { authFixturePool,seedAuthFixtures,cleanupAuthFixtures } from "./qa-auth-fixtures";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import type { User as AuthUser } from "@supabase/supabase-js";
import {
  resolveIdentity,
  completeIdentityName,
} from "../src/lib/auth-identities";
import { readUser } from "../src/lib/entity-repository";
import { sqlTeamAction } from "../src/lib/sql-teams";
import {
  namespace,
  query,
  sqlTransaction,
  closeSqlPools,
} from "../src/lib/sql";
import { exportSqlSnapshot } from "../src/lib/database-rollback";
import {
  importSnapshot,
  verifySnapshot,
  importColumns,
} from "../src/lib/database-snapshot";

async function main() {
  process.env.ARENA_NAMESPACE = `arena:qa:account:${randomUUID()}`;
  process.env.ARENA_DATABASE_MODE = "postgres";
  process.env.ARENA_RUNPOD_MODE = "disabled";
  const ns = namespace(),
    base = "http://localhost:3123",
    password = "QA-account-password-12345",
    checks: string[] = [];
  const identity = (email: string, provider = "email"): AuthUser => ({
    id: randomUUID(),
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    app_metadata: { provider, providers: [provider] },
    user_metadata: { name: "QA Người dùng" },
    identities: [],
  });
  const email = identity("email@example.test"),
    google = identity("google@example.test", "google"),
    member = identity("member@example.test"),
    wrong = identity("wrong@example.test", "google");
  const identities = [email, google, member, wrong];
  await seedAuthFixtures(identities);
  const passwords = new Map(identities.map(u=>[u.id,u===google||u===wrong?null:password]));
  const otps = new Map<string,string>();
  let recoveryRedirect="", otpRedirect="";
  const tokens = new Map<
    string,
    { user: AuthUser; target: string; confirmed: Set<string> }
  >();
  let lastTokens: string[] = [],
    challenge = "",
    wrongGoogle = false,
    wrongOtpSubject = false,
    verifyCalls = 0,
    mailRequests = 0,
    stopQA: (() => void) | undefined;
  const session = (user: AuthUser) => ({
    access_token: `qa-${user.id}`,
    refresh_token: "qa-refresh",
    expires_in: 3600,
    token_type: "bearer",
    user,
  });
  const provider = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost");
      if (url.pathname === "/__qa/stop") {
        res.end("QA stopping");
        stopQA?.();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : {};
      let status = 200,
        result: unknown = {};
      if (url.pathname.endsWith("/authorize")) {
        challenge = url.searchParams.get("code_challenge") ?? "";
        res.writeHead(303, {
          Location: base + "/auth/callback?code=qa-google",
        });
        res.end();
        return;
      } else if (url.pathname.endsWith("/token")) {
        if (url.searchParams.get("grant_type") === "pkce") {
          const valid =
            challenge ===
            createHash("sha256")
              .update(body.code_verifier ?? "")
              .digest("base64url");
          if (!valid) {
            status = 400;
            result = { code: "bad_code_verifier", message: "QA mismatch" };
          } else result = session(wrongGoogle ? wrong : google);
        } else {
          const user = identities.find((u) => u.email === body.email);
          if (!user || body.password !== passwords.get(user.id)) {
            status = 400;
            result = { code: "invalid_credentials", message: "QA invalid" };
          } else result = session(user);
        }
      } else if (url.pathname.endsWith("/user")) {
        const user = identities.find(
          (u) => req.headers.authorization === `Bearer qa-${u.id}`,
        );
        if (!user) {
          status = 401;
          result = { code: "invalid_credentials", message: "QA invalid" };
        } else if (req.method === "PUT" && body.email) {
          if (body.email === "unavailable@example.test") {
            status = 422;
            result = { code: "email_exists", message: "QA duplicate" };
          } else {
            user.new_email = body.email;
            const confirmation = {
              user,
              target: body.email,
              confirmed: new Set<string>(),
            };
            lastTokens = [
              createHash("sha256").update(randomUUID()).digest("hex"),
              createHash("sha256").update(randomUUID()).digest("hex"),
            ];
            for (const token of lastTokens) tokens.set(token, confirmation);
            mailRequests++;
            result = user;
          }
        } else if (req.method === "PUT" && body.password) {
          passwords.set(user.id,body.password);
          await authFixturePool().query("update auth.users set encrypted_password=$2 where id=$1",[user.id,"qa-password-capability"]);
          result=user;
        } else result = user;
      } else if (url.pathname.endsWith("/verify")) {
        verifyCalls++;
        if(body.type==="email") {
          const user=identities.find(u=>u.email===body.email);
          if (body.token_hash) {
            const entry=[...otps.entries()].find(([email,code])=>body.token_hash===createHash("sha256").update(email+code).digest("hex"));
            const target=entry && identities.find(u=>u.email===entry[0]);
            if(target) {otps.delete(target.email!);result=session(target);} else {status=403;result={code:"otp_expired",message:"QA used"};}
          } else if(user&&otps.get(user.email!)===body.token) {otps.delete(user.email!);result=session(wrongOtpSubject?wrong:user);}
          else {status=403;result={code:"otp_expired",message:"QA invalid"};}
          res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(result));return;
        }
        assert.equal(body.type, "email_change");
        const entry = tokens.get(body.token_hash);
        if (!entry || entry.confirmed.has(body.token_hash)) {
          status = 403;
          result = { code: "otp_expired", message: "QA expired" };
        } else {
          entry.confirmed.add(body.token_hash);
          if (entry.confirmed.size === 1)
            result = { msg: "Confirmation accepted" };
          else {
            entry.user.email = entry.target;
            await authFixturePool().query("update auth.users set email=$2 where id=$1",[entry.user.id,entry.target]);
            delete entry.user.new_email;
            result = session(entry.user);
          }
        }
      } else if(url.pathname.endsWith("/recover")) {
        recoveryRedirect=url.searchParams.get("redirect_to")??"";
      } else if(url.pathname.endsWith("/otp")) {
        assert.equal(body.create_user,false);
        otpRedirect=url.searchParams.get("redirect_to")??"";
        if(identities.some(u=>u.email===body.email))otps.set(body.email,"123456");
      } else {
        status = 404;
        result = { message: "Unexpected QA endpoint" };
      }
      res.writeHead(status, {
        "Content-Type": "application/json",
        "X-Supabase-Api-Version": "2024-01-01",
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(500);
      res.end("{}");
    }
  });
  provider.listen(3124, "127.0.0.1");
  await once(provider, "listening");
  const app = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--port", "3123"],
    {
      windowsHide: true,
      env: {
        ...process.env,
        ARENA_AUTH_MODE: "supabase",
        ARENA_GOOGLE_AUTH_ENABLED: "true",
        ARENA_AUTH_ORIGIN: base,
        SUPABASE_URL: "http://127.0.0.1:3124",
        SUPABASE_PUBLISHABLE_KEY: "qa-key",
        GROQ_RUNNER_ENABLED: "false",
        RENDER: "false",
      },
      stdio: "ignore",
    },
  );
  const jar = new Map<string, string>();
  async function request(path: string, value?: unknown, cookies = jar) {
    const r = await fetch(base + path, {
      method: value === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    for (const c of r.headers.getSetCookie()) {
      const first = c.split(";")[0],
        i = first.indexOf("=");
      if (/max-age=0/i.test(c) || !first.slice(i + 1))
        cookies.delete(first.slice(0, i));
      else cookies.set(first.slice(0, i), first.slice(i + 1));
    }
    return r;
  }
  const me = async () => (await (await request("/api/me")).json()).user;
  const login = async (user: AuthUser) =>
    assert.equal(
      (await request("/api/auth/login", { username: user.email, password }))
        .status,
      200,
    );
  const oauth = async () => {
    const r = await (
      await request("/api/auth/google", { next: "/#settings" })
    ).json();
    challenge = new URL(r.url).searchParams.get("code_challenge")!;
    return request("/auth/callback?code=qa-google");
  };
  const confirm = async (token: string) => {
    const before = verifyCalls;
    assert.equal(
      (await request(`/auth/email-change?token_hash=${token}`)).status,
      303,
    );
    assert.equal(verifyCalls, before);
    return request("/api/auth/confirm-email-change", {});
  };
  async function cleanup(target: string) {
    assert.ok(target.startsWith("arena:qa:account:"));
    process.env.ARENA_NAMESPACE = target;
    const first = ["auth_identities", "team_members", "team_invites", "admins"];
    await sqlTransaction(async (c) => {
      for (const t of [
        ...first,
        ...Object.keys(importColumns).filter((t) => !first.includes(t)),
        "migration_runs",
        "state",
      ])
        await c.query(`delete from arena.${t} where ns=$1`, [target]);
    }, true);
  }
  try {
    await query("insert into arena.state(ns,imported_at) values($1,$2)", [
      ns,
      Date.now(),
    ]);
    const localEmail = await resolveIdentity(email),
      localGoogle = await resolveIdentity(google),
      localMember = await resolveIdentity(member);
    await completeIdentityName(localGoogle.id, "QA Google tự chọn");
    await sqlTeamAction(localEmail.id, "create", { name: "QA Original Team" });
    const teamId = (await readUser(localEmail.id))!.teamId!;
    const invite = (
      await query("select invite_code from arena.teams where ns=$1 and id=$2", [
        ns,
        teamId,
      ])
    )[0].invite_code;
    await sqlTeamAction(localMember.id, "join", { code: invite });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(
      (await request("/api/auth/name", { name: "Forbidden" })).status,
      401,
    );
    assert.equal(
      (await request("/api/auth/change-email", { email: "new@example.test" }))
        .status,
      401,
    );
    assert.equal((await request("/api/auth/school",{school:"Forbidden"})).status,401);
    for (const path of ["/privacy", "/terms"]) {
      const r = await request(path);
      assert.equal(r.status, 200);
      assert.match(await r.text(), /nhatlong30042006@gmail.com/);
    }
    checks.push("public legal pages and guest mutation protection");
    await login(member);
    assert.equal(
      (await request("/api/team", { action: "rename", name: "Not allowed" }))
        .status,
      403,
    );
    await request("/api/auth/logout", {});
    await login(email);
    assert.equal((await me()).loginProvider, "email");
    assert.equal((await request("/api/auth/school",{school:"x".repeat(161)})).status,400);
    assert.equal((await request("/api/auth/school",{school:"  Đại học   Bách khoa  – ĐH Đà Nẵng  ",userId:localMember.id})).status,200);
    let schoolSettings=await (await request("/api/arena")).json();
    assert.equal(schoolSettings.account.school,"Đại học Bách khoa – ĐH Đà Nẵng");
    assert.equal((await query("select school from arena.account_profiles where ns=$1 and user_id=$2",[ns,localMember.id]))[0]?.school??null,null);
    await request("/api/auth/logout",{});await login(email);
    schoolSettings=await (await request("/api/arena")).json();
    assert.equal(schoolSettings.account.school,"Đại học Bách khoa – ĐH Đà Nẵng");
    assert.equal((await request("/api/auth/school",{school:"   "})).status,200);
    assert.equal((await (await request("/api/arena")).json()).account.school,null);
    assert.equal((await request("/api/auth/school",{school:"Đại học Bách khoa – ĐH Đà Nẵng"})).status,200);
    checks.push("optional school validation, whitespace normalization, own-user writes, persistence after login, clearing and backup-ready profile");

    assert.equal(
      (
        await request("/api/team", {
          action: "rename",
          name: "QA Renamed Team",
        })
      ).status,
      200,
    );
    const unchanged = (
      await query(
        "select id,invite_code,name from arena.teams where ns=$1 and id=$2",
        [ns, teamId],
      )
    )[0];
    assert.equal(unchanged.invite_code, invite);
    assert.equal(unchanged.name, "QA Renamed Team");
    assert.equal(
      (await request("/api/auth/name", { name: "x@example.test" })).status,
      400,
    );
    const race = await Promise.all([
      request("/api/auth/name", { name: "QA Đổi tên A" }),
      request("/api/auth/name", { name: "QA Đổi tên B" }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 429]);
    assert.equal(
      (await request("/api/auth/name", { name: "QA Again" })).status,
      429,
    );
    await query(
      "update arena.account_profiles set name_changed_at=$3 where ns=$1 and user_id=$2",
      [ns, localEmail.id, Date.now() - 31 * 86400_000],
    );
    assert.equal(
      (await request("/api/auth/name", { name: "QA Sau 30 ngày" })).status,
      200,
    );
    checks.push(
      "captain-only team rename preserves team identity; atomic 30-day name cooldown and reopening",
    );
    assert.equal(
      (
        await request("/api/auth/change-email", {
          email: email.email,
          current: password,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/auth/change-email", {
          email: member.email,
          current: password,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/api/auth/change-email", {
          email: "new@example.test",
          current: "bad",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/api/auth/change-email", {
          email: "new@example.test",
          current: password,
        })
      ).status,
      200,
    );
    assert.equal((await me()).username, "email@example.test");
    let settings = await (await request("/api/arena")).json();
    assert.equal(settings.account.pendingEmail, "new@example.test");
    assert.equal(settings.account.emailChangeAt, null);
    const oldCookies = new Map(jar),
      emailTokens = [...lastTokens];
    assert.equal((await confirm(emailTokens[0])).status, 200);
    assert.equal((await me()).username, "email@example.test");
    const done = await confirm(emailTokens[1]);
    assert.equal((await done.json()).complete, true);
    assert.equal(
      (await (await request("/api/me", undefined, oldCookies)).json()).user,
      null,
    );
    await login(email);
    const changed = await me();
    assert.equal(changed.id, localEmail.id);
    assert.equal(changed.teamId, teamId);
    assert.equal(changed.name, "QA Sau 30 ngày");
    assert.equal(changed.username, "new@example.test");
    assert.equal(
      (
        await request("/api/auth/change-email", {
          email: "second@example.test",
          current: password,
        })
      ).status,
      429,
    );
    assert.equal((await confirm(emailTokens[1])).status, 400);
    checks.push(
      "password reauthentication, duplicate email rejection, dual confirmation, link scan safety, session revocation, stable account/team and separate email cooldown",
    );
    await request("/api/auth/logout", {});
    assert.equal((await oauth()).status, 303);
    assert.equal((await me()).loginProvider, "google");
    assert.equal(
      (
        await request("/api/password", {
          current: password,
          password: "Different-password-12345",
        })
      ).status,
      403,
    );
    settings=await (await request("/api/arena")).json();
    assert.equal(settings.account.passwordEnabled,false);assert.equal(settings.account.googleLinked,true);assert.equal(settings.account.canChangeEmail,false);
    assert.equal((await request("/api/auth/change-email",{email:"google-new@example.test"})).status,403);
    await request("/api/auth/logout",{});
    assert.equal((await request("/api/auth/forgot",{username:google.email})).status,200);
    assert.equal(new URL(recoveryRedirect).searchParams.get("intent"),"google-reminder");
    assert.equal((await request("/api/auth/forgot",{username:email.email})).status,200);
    assert.equal(new URL(recoveryRedirect).searchParams.get("intent"),null);
    await oauth();
    assert.equal((await request("/api/auth/set-password",{token:"000000",password,confirmation:password})).status,400);
    assert.equal((await request("/api/auth/password-otp",{})).status,200);
    assert.equal(new URL(otpRedirect).searchParams.get("intent"),"password-setup");
    assert.equal((await request("/api/auth/set-password",{token:"123456",password,confirmation:"Mismatch-password"})).status,400);
    wrongOtpSubject=true;
    assert.equal((await request("/api/auth/set-password",{token:"123456",password,confirmation:password})).status,403);
    wrongOtpSubject=false;otps.set(google.email!,"123456");
    const revoked=new Map(jar);
    assert.equal((await request("/api/auth/set-password",{token:"123456",password,confirmation:password})).status,200);
    assert.equal((await (await request("/api/me",undefined,revoked)).json()).user,null);
    settings=await (await request("/api/arena")).json();
    assert.equal(settings.account.passwordEnabled,true);assert.equal(settings.account.googleLinked,true);
    assert.equal((await request("/api/auth/set-password",{token:"123456",password,confirmation:password})).status,409);
    await request("/api/auth/logout",{});await login(google);assert.equal((await me()).id,localGoogle.id);
    await request("/api/auth/logout",{});await oauth();
    assert.equal((await request("/api/password",{current:"wrong",password:password+"-new"})).status,401);
    assert.equal((await request("/api/password",{current:password,password:password+"-new"})).status,200);
    assert.equal((await request("/api/password",{current:password+"-new",password})).status,200);
    await request("/api/auth/logout",{});await oauth();
    checks.push("Google-only recovery reminder, email recovery, read-only Google email, OTP-gated password setup, mismatch/replay protection, revoked sessions and email/password login with same identity");
    await request("/api/auth/logout",{});await login(google);
    const start = await request("/api/auth/change-email", {
      email: "google-new@example.test",
    });
    assert.equal(start.status, 200);
    let startData = await start.json();
    challenge = new URL(startData.url).searchParams.get("code_challenge")!;
    wrongGoogle = true;
    const rejected = await request("/auth/callback?code=qa-google");
    assert.equal(new URL(rejected.headers.get("location")!).pathname, "/login");
    assert.equal(mailRequests, 1);
    wrongGoogle = false;
    const retry = await request("/api/auth/change-email", {
      email: "google-new@example.test",
    });
    assert.equal(retry.status, 200);
    startData = await retry.json();
    challenge = new URL(startData.url).searchParams.get("code_challenge")!;
    const accepted = await request("/auth/callback?code=qa-google");
    assert.equal(new URL(accepted.headers.get("location")!).hash, "#settings");
    assert.equal(mailRequests, 2);
    const googleTokens = [...lastTokens];
    assert.equal(
      (await (await confirm(googleTokens[0])).json()).complete,
      false,
    );
    assert.equal(
      (await (await confirm(googleTokens[1])).json()).complete,
      true,
    );
    jar.clear();
    await oauth();
    assert.equal((await me()).id, localGoogle.id);
    assert.equal((await me()).name, "QA Google tự chọn");
    assert.equal((await me()).username, "google-new@example.test");
    checks.push(
      "Google capability checks, same-subject reauthentication, Google email change and returning login with stable identity",
    );
    await request("/api/auth/logout",{});
    assert.equal((await request("/api/auth/otp",{username:member.email,next:"/#team"})).status,200);
    assert.equal((await request("/api/auth/otp",{username:member.email,next:"/#team"})).status,429);
    assert.equal((await request("/api/auth/verify-otp",{username:member.email,token:"000000"})).status,400);
    assert.equal((await request("/api/auth/verify-otp",{username:member.email,token:"123456"})).status,200);
    assert.equal((await me()).id,localMember.id);assert.equal((await me()).teamId,teamId);
    await request("/api/auth/logout",{});
    assert.equal((await request("/api/auth/verify-otp",{username:member.email,token:"123456"})).status,400);
    assert.equal((await request("/api/auth/otp",{username:"missing@example.test"})).status,200);
    assert.equal((await request("/api/auth/otp",{username:email.email,next:"/#settings"})).status,200);
    const linkHash=createHash("sha256").update(email.email+"123456").digest("hex"), beforeVerify=verifyCalls;
    const foreignJar=new Map<string,string>();
    assert.equal((await request(`/auth/email-login?token_hash=${linkHash}`,undefined,foreignJar)).status,303);
    assert.equal(verifyCalls,beforeVerify);
    const crossDevice=await request("/api/auth/confirm-login",{},foreignJar);
    assert.equal(crossDevice.status,200);assert.equal((await crossDevice.json()).next,"/");
    assert.equal((await (await request("/api/me",undefined,foreignJar)).json()).user.id,localEmail.id);
    await request("/api/auth/logout",{},foreignJar);
    await request(`/auth/email-login?token_hash=${linkHash}`,undefined,foreignJar);
    assert.equal((await request("/api/auth/confirm-login",{},foreignJar)).status,400);
    checks.push("existing-account OTP login, wrong/used code rejection, generic nonexistent response, scanner-safe cross-device Magic Link, one-time token and stable team identity");
    const snapshot = await exportSqlSnapshot(),
      restore = ns + ":restore";
    assert.ok(snapshot.sqlRuntime!.account_profiles.length > 0);
    process.env.ARENA_NAMESPACE = restore;
    try {
      await importSnapshot(snapshot);
      assert.equal((await verifySnapshot(snapshot)).result, "PASS");
    } finally {
      await cleanup(restore);
      process.env.ARENA_NAMESPACE = ns;
    }
    checks.push(
      "SQL export/restore preserves account cooldown, provider metadata and pending email state",
    );
    await request("/api/auth/logout", {});
    const fixture = {
      namespace: ns,
      base,
      password,
      email: email.email,
      google: google.email,
      member: member.email,
      teamId,
    };
    await writeFile(
      ".local/account-settings-browser.json",
      JSON.stringify(fixture),
    );
    const proof = {
      result: "PASS",
      checks,
      realSQL: true,
      authProvider: "mock",
      realEmailsSent: 0,
      paidResources: 0,
    };
    await writeFile(
      ".local/account-settings-qa.json",
      JSON.stringify(proof, null, 2),
    );
    console.log(JSON.stringify(proof));
    if (process.argv.includes("--keep")) {
      // The browser starts with fresh request counters after API rate-limit QA.
      await query("delete from arena.rate_counters where ns=$1",[ns]);
      console.log(`Local QA ready at ${base}`);
      await new Promise<void>((resolve) => {
        stopQA = resolve;
        process.once("SIGINT", resolve);
      });
    }
  } finally {
    app.kill();
    provider.close();
    await cleanup(ns);
    await closeSqlPools();
    await cleanupAuthFixtures(identities);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : "QA failed");
  process.exitCode = 1;
});
