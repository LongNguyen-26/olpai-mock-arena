import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { User as AuthUser } from "@supabase/supabase-js";
import { ApiError } from "./api-error";
import {
  namespace,
  query,
  sqlNow,
  sqlTransaction,
  bumpRevision,
  usingPostgres,
} from "./sql";
import {
  accountChangeAllowed,
  EMAIL_REQUEST_TTL,
  nextAccountChange,
} from "./account-policy";
import { profileName, registrationName } from "./auth-input";
import { db, key } from "./db";
import { readUser } from "./entity-repository";
import { accountAuthMethods } from "./account-auth-methods";

export async function accountSettings(userId: string) {
  const methods = await accountAuthMethods(userId);
  if (!usingPostgres()) {
    const user = await readUser(userId);
    return {
      nameChangeAt: nextAccountChange(user?.nameChangedAt),
      school: user?.school ?? null,
      emailChangeAt: null,
      pendingEmail: null as string | null,
      canChangeEmail: false,
      ...methods,
    };
  }
  const row = (
    await query(
      `select p.*,i.subject from arena.users u
    left join arena.account_profiles p on p.ns=u.ns and p.user_id=u.id
    left join arena.auth_identities i on i.ns=u.ns and i.user_id=u.id
    where u.ns=$1 and u.id=$2 and u.deleted_at is null`,
      [namespace(), userId],
    )
  )[0];
  return {
    nameChangeAt: nextAccountChange(row?.name_changed_at),
    school: (row?.school as string | null) ?? null,
    emailChangeAt: nextAccountChange(row?.email_changed_at),
    pendingEmail: (row?.pending_email as string | null) ?? null,
    canChangeEmail: !!row?.subject && methods.passwordEnabled,
    ...methods,
  };
}
export async function changeAccountSchool(userId: string, value: unknown) {
  const school = z.string().transform(v => v.normalize("NFC").replace(/\s+/gu," ").trim())
    .pipe(z.string().max(160).refine(v => !/[\u0000-\u001f\u007f]/u.test(v),"Tên trường chứa ký tự không hợp lệ."))
    .parse(value) || null;
  if (!usingPostgres()) {
    const result=await db().eval<unknown[],number>(
      "local raw=redis.call('GET',KEYS[1]);if not raw then return 0 end;local u=cjson.decode(raw);u.school=cjson.decode(ARGV[1]);redis.call('SET',KEYS[1],cjson.encode(u));return 1",
      [key(`user:${userId}`)],[JSON.stringify(school)]);
    if (!result) throw new ApiError("Tài khoản không còn khả dụng.",401);
    return;
  }
  await sqlTransaction(async client => {
    const changed=await client.query(`insert into arena.account_profiles(ns,user_id,school)
      select ns,id,$3 from arena.users where ns=$1 and id=$2 and deleted_at is null
      on conflict(ns,user_id) do update set school=excluded.school returning user_id`,[namespace(),userId,school]);
    if (!changed.rowCount) throw new ApiError("Tài khoản không còn khả dụng.",401);
    await bumpRevision(client);
  },true);
}
export async function changeAccountName(userId: string, value: unknown) {
  const name = profileName.parse(value);
  if (!usingPostgres()) {
    const result = await db().eval<unknown[], string>(
      `local raw=redis.call('GET',KEYS[1]);if not raw then return 'missing' end
      local u=cjson.decode(raw); local t=redis.call('TIME');local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
      if u.name==ARGV[1] then return 'same' end
      if type(u.nameChangedAt)=='number' and now<u.nameChangedAt+2592000000 then return 'wait' end
      u.name=ARGV[1];u.nameChangedAt=now;redis.call('SET',KEYS[1],cjson.encode(u));return 'ok'`,
      [key(`user:${userId}`)],
      [name],
    );
    if (result !== "ok")
      throw new ApiError(
        result === "wait"
          ? "Bạn chỉ có thể đổi tên một lần trong 30 ngày."
          : result === "same"
            ? "Tên mới cần khác tên hiện tại."
            : "Tài khoản không còn khả dụng.",
        result === "wait" ? 429 : 400,
      );
    return;
  }
  await sqlTransaction(async (client) => {
    const ns = namespace(),
      now = await sqlNow(client);
    const user = (
      await client.query(
        "select name from arena.users where ns=$1 and id=$2 and deleted_at is null",
        [ns, userId],
      )
    ).rows[0];
    if (!user) throw new ApiError("Tài khoản không còn khả dụng.", 401);
    if (user.name === name)
      throw new ApiError("Tên mới cần khác tên hiện tại.");
    const last = (
      await client.query(
        "select name_changed_at from arena.account_profiles where ns=$1 and user_id=$2",
        [ns, userId],
      )
    ).rows[0]?.name_changed_at;
    if (!accountChangeAllowed(last, now))
      throw new ApiError("Bạn chỉ có thể đổi tên một lần trong 30 ngày.", 429);
    await client.query(
      "insert into arena.account_profiles(ns,user_id,name_changed_at) values($1,$2,$3) on conflict(ns,user_id) do update set name_changed_at=excluded.name_changed_at",
      [ns, userId, now],
    );
    await client.query("update arena.users set name=$3 where ns=$1 and id=$2", [
      ns,
      userId,
      name,
    ]);
    await bumpRevision(client);
  }, true);
}
export async function reserveEmailChange(userId: string, value: unknown) {
  const email = registrationName.parse(value);
  return sqlTransaction(async (client) => {
    const ns = namespace(),
      now = await sqlNow(client);
    const user = (
      await client.query(
        "select u.username,i.subject from arena.users u join arena.auth_identities i on i.ns=u.ns and i.user_id=u.id where u.ns=$1 and u.id=$2 and u.deleted_at is null",
        [ns, userId],
      )
    ).rows[0];
    if (!user)
      throw new ApiError(
        "Hãy liên kết tài khoản Google trước khi đổi email.",
        409,
      );
    if (user.username.toLowerCase() === email)
      throw new ApiError("Email mới cần khác email hiện tại.");
    const profile = (
      await client.query(
        "select * from arena.account_profiles where ns=$1 and user_id=$2",
        [ns, userId],
      )
    ).rows[0];
    if (!accountChangeAllowed(profile?.email_changed_at, now))
      throw new ApiError(
        "Bạn chỉ có thể đổi email một lần trong 30 ngày.",
        429,
      );
    if (
      profile?.pending_requested_at &&
      now - Number(profile.pending_requested_at) < 60_000
    )
      throw new ApiError(
        "Vui lòng đợi một phút trước khi gửi lại yêu cầu.",
        429,
      );
    const conflict = await client.query(
      `select 1 from arena.users where ns=$1 and lower(username)=$2 and deleted_at is null
      union all select 1 from arena.account_profiles where ns=$1 and lower(pending_email)=$2 and user_id<>$3 and pending_requested_at>$4`,
      [ns, email, userId, now - EMAIL_REQUEST_TTL],
    );
    if (conflict.rowCount)
      throw new ApiError(
        "Không thể sử dụng email này. Hãy chọn địa chỉ khác.",
        409,
      );
    const requestId = randomUUID();
    await client.query(
      `insert into arena.account_profiles(ns,user_id,pending_email,pending_requested_at,pending_id) values($1,$2,$3,$4,$5)
      on conflict(ns,user_id) do update set pending_email=excluded.pending_email,pending_requested_at=excluded.pending_requested_at,pending_id=excluded.pending_id`,
      [ns, userId, email, now, requestId],
    );
    await bumpRevision(client);
    return { email, requestId, subject: String(user.subject) };
  }, true);
}
export async function pendingEmailChange(userId: string, requestId: string) {
  const row = (
    await query(
      "select p.*,i.subject from arena.account_profiles p join arena.auth_identities i on i.ns=p.ns and i.user_id=p.user_id where p.ns=$1 and p.user_id=$2 and p.pending_id=$3",
      [namespace(), userId, requestId],
    )
  )[0];
  if (
    !row?.pending_email ||
    Date.now() - Number(row.pending_requested_at) > EMAIL_REQUEST_TTL
  )
    throw new ApiError("Yêu cầu đổi email đã hết hạn. Hãy bắt đầu lại.", 409);
  return { email: String(row.pending_email), subject: String(row.subject) };
}
export async function clearEmailRequest(userId: string, requestId: string) {
  await query(
    "update arena.account_profiles set pending_email=null,pending_requested_at=null,pending_id=null where ns=$1 and user_id=$2 and pending_id=$3",
    [namespace(), userId, requestId],
  );
}
// Only a fresh identity returned by Supabase may commit an email. Never accept a client email as proof.
export async function syncVerifiedIdentityEmail(identity: AuthUser) {
  if (
    !identity.email_confirmed_at ||
    identity.is_anonymous ||
    identity.new_email
  )
    return false;
  const email = registrationName.parse(identity.email);
  return sqlTransaction(async (client) => {
    const ns = namespace(),
      now = await sqlNow(client);
    const found = (
      await client.query(
        `select u.id,u.username,p.* from arena.auth_identities i
      join arena.users u on u.ns=i.ns and u.id=i.user_id join arena.account_profiles p on p.ns=u.ns and p.user_id=u.id
      where i.ns=$1 and i.subject=$2 and u.deleted_at is null`,
        [ns, identity.id],
      )
    ).rows[0];
    if (!found || found.pending_email !== email) return false;
    if (!accountChangeAllowed(found.email_changed_at, now))
      throw new ApiError(
        "Email đã được thay đổi gần đây. Vui lòng liên hệ hỗ trợ.",
        409,
      );
    if (
      (
        await client.query(
          "select 1 from arena.users where ns=$1 and lower(username)=$2 and id<>$3 and deleted_at is null",
          [ns, email, found.user_id],
        )
      ).rowCount
    )
      throw new ApiError(
        "Email trùng tài khoản khác. Vui lòng liên hệ hỗ trợ.",
        409,
      );
    await client.query(
      "update arena.users set username=$3 where ns=$1 and id=$2",
      [ns, found.user_id, email],
    );
    await client.query(
      "update arena.account_profiles set email_changed_at=$3,pending_email=null,pending_requested_at=null,pending_id=null where ns=$1 and user_id=$2",
      [ns, found.user_id, now],
    );
    await client.query(
      "delete from arena.sessions where ns=$1 and user_id=$2",
      [ns, found.user_id],
    );
    await bumpRevision(client);
    return true;
  }, true);
}
