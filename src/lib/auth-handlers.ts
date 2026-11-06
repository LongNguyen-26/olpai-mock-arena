import { cookies } from "next/headers";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { checkPassword, createSession, getUser, hashPassword, logout, rateLimit, requireUser } from "./auth";
import { ApiError } from "./api-error";
import { loginName, registrationName } from "./auth-input";
import { authReturnPath } from "./auth-navigation";
import { authCookieOptions, authOptions, authOrigin, providerError, supabaseAuth } from "./supabase-auth";
import { completeIdentityName, identitySubject, resolveIdentity } from "./auth-identities";
import { createSqlUser, readUser, readUserId } from "./entity-repository";
import { db, key } from "./db";
import { namespace, query, usingPostgres } from "./sql";

export const flowCookie = "arena-auth-flow";
export async function beginAuthFlow(mode: "login" | "link" | "recovery", next: unknown, userId?: string) {
  (await cookies()).set(flowCookie, JSON.stringify({ mode, next: authReturnPath(next), userId }), authCookieOptions);
  return `${authOrigin()}/auth/callback`;
}
const json = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "private, no-store" } });
const password = z.string().min(10).max(128);
export async function handleAuth(req: Request, route: string, value: unknown) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (route === "auth/profile") {
    const user = await getUser();
    if (!user) throw new ApiError("Vui lòng đăng nhập.",401);
    if (!user.needsName) throw new ApiError("Tên tài khoản đã được hoàn tất.",409);
    await rateLimit(`profile:${user.id}`,10,900);
    const input = z.object({name:z.string()}).parse(value);
    await completeIdentityName(user.id,input.name);
    return json({ok:true});
  }
  if (route === "auth/logout") {
    await logout();
    const jar = await cookies();
    for (const name of [flowCookie, "arena-auth-verifier", "arena-auth-recovery"]) jar.delete(name);
    return json({ ok: true });
  }
  if (route === "auth/google") {
    if (!authOptions().google) throw new ApiError("Đăng nhập Google chưa được mở.",503);
    const input = z.object({ next: z.string().optional(), link: z.boolean().optional() }).parse(value);
    const local = input.link ? await requireUser() : null;
    await rateLimit(`google:${ip}`, 30, 900);
    const client = await supabaseAuth();
    const redirectTo = await beginAuthFlow(local ? "link" : "login", input.next, local?.id);
    const result = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } } });
    providerError(result.error);
    if (!result.data.url) throw new ApiError("Không thể mở đăng nhập Google.",503);
    return json({ url: result.data.url });
  }
  if (route === "auth/register") {
    const input = z.object({ username: registrationName, name: z.string().trim().min(2).max(60), password, next: z.string().optional() }).parse(value);
    await rateLimit(`register:${ip}`,10,3600);
    if (authOptions().supabase) {
      if (await readUserId(input.username)) throw new ApiError("Email đã có tài khoản Arena. Hãy đăng nhập bằng mật khẩu hiện có.",409);
      const client = await supabaseAuth();
      const emailRedirectTo = await beginAuthFlow("login",input.next);
      const result = await client.auth.signUp({ email: input.username, password: input.password, options: { data: { name: input.name }, emailRedirectTo } });
      providerError(result.error);
      // Even if the provider is misconfigured to autoconfirm, do not issue an
      // Arena session here. Only an explicitly verified identity can log in.
      return json({ ok: true, confirmationRequired: true });
    }
    const user = { id:randomUUID(),username:input.username,name:input.name,password:await hashPassword(input.password),teamId:null,createdAt:Date.now() };
    const created = usingPostgres() ? await createSqlUser(user) : await db().eval<unknown[],number>(
      "if redis.call('EXISTS',KEYS[1])==1 then return 0 end;redis.call('SET',KEYS[1],ARGV[1]);redis.call('SET',KEYS[2],ARGV[2]);return 1",
      [key(`username:${user.username}`),key(`user:${user.id}`)],[user.id,JSON.stringify(user)]);
    if (!created) throw new ApiError("Email đã được đăng ký.",409);
    await createSession(user.id); return json({ ok:true });
  }
  if (route === "auth/login") {
    const input = z.object({ username:loginName,password:z.string().min(1).max(128) }).parse(value);
    await rateLimit(`login:ip:${ip}`,60,900);
    await rateLimit(`login:${input.username}`,15,900);
    const id = await readUserId(input.username), user = id ? await readUser(id) : null;
    if (user && user.password !== "external:supabase") {
      if (!(await checkPassword(input.password,user.password))) throw new ApiError("Tên đăng nhập hoặc mật khẩu không đúng.",401);
      await createSession(user.id); return json({ok:true});
    }
    if (authOptions().supabase && registrationName.safeParse(input.username).success) {
      const client = await supabaseAuth();
      const result = await client.auth.signInWithPassword({ email: input.username, password: input.password });
      providerError(result.error);
      if (!result.data.user) throw new ApiError("Email hoặc mật khẩu không đúng.",401);
      const local = await resolveIdentity(result.data.user);
      await createSession(local.id); return json({ok:true,needsName:local.needsName});
    }
    await checkPassword(input.password, `${"0".repeat(32)}:${"0".repeat(128)}`);
    throw new ApiError("Tên đăng nhập hoặc mật khẩu không đúng.",401);
  }
  if (route === "auth/resend" || route === "auth/forgot") {
    const input = z.object({ username:registrationName,next:z.string().optional() }).parse(value);
    await rateLimit(`email:ip:${ip}`,10,3600);
    await rateLimit(`email:${input.username}`,1,60);
    const client = await supabaseAuth();
    const redirectTo = await beginAuthFlow(route === "auth/forgot" ? "recovery" : "login",input.next);
    if (route === "auth/forgot") {
      // Do not reset unverified legacy accounts by email alone.
      const id = await readUserId(input.username), record = id ? await readUser(id) : null;
      if (record && record.password !== "external:supabase") return json({ok:true});
      providerError((await client.auth.resetPasswordForEmail(input.username,{redirectTo})).error);
    } else providerError((await client.auth.resend({type:"signup",email:input.username,options:{emailRedirectTo:redirectTo}})).error);
    return json({ok:true});
  }
  if (route === "auth/reset") {
    const input = z.object({password}).parse(value);
    await rateLimit(`reset:${ip}`,10,900);
    const jar = await cookies(), token = jar.get("arena-auth-recovery")?.value;
    if (!token) throw new ApiError("Liên kết đã hết hạn. Hãy yêu cầu đặt lại mật khẩu.",401);
    const client = await supabaseAuth();
    const verified = await client.auth.getUser(token);
    providerError(verified.error);
    if (!verified.data.user?.email_confirmed_at) throw new ApiError("Liên kết không hợp lệ.",401);
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`,{method:"PUT",headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY!,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({password:input.password}),cache:"no-store"});
    if (!response.ok) { const error = await response.json(); providerError(error); throw new ApiError("Không thể cập nhật mật khẩu."); }
    const rows = await query("select user_id from arena.auth_identities where ns=$1 and subject=$2",[namespace(),verified.data.user.id]);
    if (rows[0]) await query("delete from arena.sessions where ns=$1 and user_id=$2",[namespace(),rows[0].user_id]);
    jar.delete("arena-auth-recovery");
    await logout();
    return json({ok:true});
  }
  throw new ApiError("Không tìm thấy chức năng.",404);
}

export async function changeExternalPassword(userId: string, email: string, current: string, password: string) {
  const subject = await identitySubject(userId);
  if (!subject) throw new ApiError("Tài khoản chưa được liên kết.",409);
  const client = await supabaseAuth();
  const signed = await client.auth.signInWithPassword({email,password:current});
  providerError(signed.error);
  if (signed.data.user?.id !== subject) throw new ApiError("Mật khẩu hiện tại không đúng.",401);
  providerError((await client.auth.updateUser({password})).error);
  await query("delete from arena.sessions where ns=$1 and user_id=$2",[namespace(),userId]);
  await createSession(userId);
}
