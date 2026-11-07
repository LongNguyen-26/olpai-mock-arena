import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authCookieOptions, authOrigin } from "@/lib/supabase-auth";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token_hash");
  const valid = !!token && /^[a-zA-Z0-9_-]{32,256}$/.test(token);
  const jar = await cookies();
  if (valid) jar.set("arena-email-login",token,{...authCookieOptions,maxAge:600});
  else jar.delete("arena-email-login");
  // Email scanners can open this URL without consuming the one-time token.
  return NextResponse.redirect(new URL(valid ? "/email-login" : "/email-login?invalid=1",authOrigin()),{status:303,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
}
