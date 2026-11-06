import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, getUser } from "@/lib/auth";
import { ApiError } from "@/lib/api-error";
import { resolveIdentity } from "@/lib/auth-identities";
import { flowCookie } from "@/lib/auth-handlers";
import { authReturnPath } from "@/lib/auth-navigation";
import { authCookieOptions, authOrigin, providerError, supabaseAuth } from "@/lib/supabase-auth";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const jar = await cookies();
  let destination = "/";
  try {
    const url = new URL(req.url), code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error")) throw new ApiError("Đăng nhập đã bị hủy hoặc liên kết không còn hợp lệ.");
    const flow = JSON.parse(jar.get(flowCookie)?.value ?? "null");
    if (!flow || !["login","link","recovery"].includes(flow.mode)) throw new ApiError("Phiên xác thực đã hết hạn. Hãy bắt đầu lại trên trình duyệt này.");
    const client = await supabaseAuth();
    const verifier = JSON.parse(jar.get("arena-auth-verifier")?.value ?? "null");
    const recoveryFlow = typeof verifier === "string" && verifier.endsWith("/recovery");
    const result = await client.auth.exchangeCodeForSession(code);
    providerError(result.error);
    if (!result.data.user?.email_confirmed_at || !result.data.session) throw new ApiError("Email chưa được xác minh.");
    if (flow.mode === "recovery") {
      if (!recoveryFlow) throw new ApiError("Liên kết không phải yêu cầu đặt lại mật khẩu.");
      jar.set("arena-auth-recovery",result.data.session.access_token,{...authCookieOptions,maxAge:600});
      destination = "/login?mode=reset";
    } else {
      const current = await getUser();
      if (flow.mode === "link" && (!current || current.id !== flow.userId)) throw new ApiError("Hãy đăng nhập lại tài khoản cũ trước khi liên kết Google.");
      if (flow.mode === "login" && current) throw new ApiError("Bạn đang đăng nhập một tài khoản. Hãy đăng xuất trước khi đổi tài khoản.");
      const local = await resolveIdentity(result.data.user,flow.mode === "link" ? current!.id : undefined);
      await createSession(local.id);
      destination = authReturnPath(flow.next);
    }
  } catch (error) {
    destination = `/login?error=${encodeURIComponent(error instanceof ApiError ? error.message : "Liên kết đã hết hạn hoặc được mở trên trình duyệt khác. Hãy đăng nhập hoặc gửi lại email.")}`;
  } finally {
    jar.delete(flowCookie); jar.delete("arena-auth-verifier");
  }
  return NextResponse.redirect(new URL(destination,authOrigin()),{status:303,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
}
