import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, getUser } from "@/lib/auth";
import { ApiError } from "@/lib/api-error";
import { resolveIdentity } from "@/lib/auth-identities";
import { flowCookie,sendEmailChange } from "@/lib/auth-handlers";
import { clearEmailRequest,pendingEmailChange,syncVerifiedIdentityEmail } from "@/lib/account-profile";
import { authReturnPath } from "@/lib/auth-navigation";
import { authCookieOptions, authOrigin, providerError, supabaseAuth } from "@/lib/supabase-auth";
import { requirePasswordAccount } from "@/lib/account-auth-methods";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const jar = await cookies();
  let destination = "/";
  let preserveFlow=false;
  try {
    const url = new URL(req.url), code = url.searchParams.get("code");
    const flow = JSON.parse(jar.get(flowCookie)?.value ?? "null");
    if (!flow || !["login","google","link","recovery","email-reauth","email-confirm"].includes(flow.mode)) throw new ApiError("Phiên xác thực đã hết hạn. Hãy bắt đầu lại trên trình duyệt này.");
    if(flow.mode==="email-confirm"&&!code&&url.searchParams.has("message")&&!url.searchParams.has("error")) {
      preserveFlow=true;
      return NextResponse.redirect(new URL("/email-change?status=waiting",authOrigin()),303);
    }
    if (!code || url.searchParams.has("error")) throw new ApiError("Đăng nhập đã bị hủy hoặc liên kết không còn hợp lệ.");
    const client = await supabaseAuth();
    const verifier = JSON.parse(jar.get("arena-auth-verifier")?.value ?? "null");
    const recoveryFlow = typeof verifier === "string" && verifier.endsWith("/recovery");
    const result = await client.auth.exchangeCodeForSession(code);
    providerError(result.error);
    if (!result.data.user?.email_confirmed_at || !result.data.session) throw new ApiError("Email chưa được xác minh.");
    if(flow.mode==="email-reauth") {
      const current=await getUser();
      if(!current||current.id!==flow.userId)throw new ApiError("Hãy đăng nhập lại trước khi đổi email.",401);
      try {await sendEmailChange(client,current.id,flow.requestId);}
      catch(error){await clearEmailRequest(current.id,flow.requestId);throw error;}
      preserveFlow=true;
      destination="/#settings";
    } else if(flow.mode==="email-confirm") {
      const pending=await pendingEmailChange(flow.userId,flow.requestId);
      if(result.data.user.id!==pending.subject)throw new ApiError("Liên kết không thuộc tài khoản yêu cầu.",403);
      const complete=await syncVerifiedIdentityEmail(result.data.user);
      destination=complete?"/email-change?status=complete":"/email-change?status=waiting";
    } else if (flow.mode === "recovery") {
      if (!recoveryFlow) throw new ApiError("Liên kết không phải yêu cầu đặt lại mật khẩu.");
      const local = await resolveIdentity(result.data.user);
      await requirePasswordAccount(local.id);
      jar.set("arena-auth-recovery",result.data.session.access_token,{...authCookieOptions,maxAge:600});
      destination = "/login?mode=reset";
    } else {
      const current = await getUser();
      if (flow.mode === "link" && (!current || current.id !== flow.userId)) throw new ApiError("Hãy đăng nhập lại tài khoản cũ trước khi liên kết Google.");
      if (["login","google"].includes(flow.mode) && current) throw new ApiError("Bạn đang đăng nhập một tài khoản. Hãy đăng xuất trước khi đổi tài khoản.");
      const local = await resolveIdentity(result.data.user,flow.mode === "link" ? current!.id : undefined);
      await createSession(local.id,flow.mode==="login"?"email":"google");
      destination = authReturnPath(flow.next);
      if (local.needsName) destination = `/onboarding?next=${encodeURIComponent(destination)}`;
    }
  } catch (error) {
    destination = `/login?error=${encodeURIComponent(error instanceof ApiError ? error.message : "Liên kết đã hết hạn hoặc được mở trên trình duyệt khác. Hãy đăng nhập hoặc gửi lại email.")}`;
  } finally {
    if(!preserveFlow){jar.delete(flowCookie); jar.delete("arena-auth-verifier");}
  }
  return NextResponse.redirect(new URL(destination,authOrigin()),{status:303,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
}
