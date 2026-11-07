import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { ApiError } from "./api-error";
import { usingPostgres } from "./sql";

export function authOptions() {
  return { supabase: process.env.ARENA_AUTH_MODE === "supabase", google: process.env.ARENA_AUTH_MODE === "supabase" && process.env.ARENA_GOOGLE_AUTH_ENABLED === "true" };
}
export function authOrigin() {
  const url = new URL(process.env.ARENA_AUTH_ORIGIN ?? "https://olpaiarena.cyou");
  if (url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))) throw new ApiError("Cấu hình địa chỉ xác thực không hợp lệ.", 503);
  return url.origin;
}
export const authCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 3600 };

// Auth runs entirely on the server. Only the short-lived PKCE verifier is kept
// in a cookie; provider access/refresh tokens never reach client JavaScript.
export async function supabaseAuth() {
  if (!authOptions().supabase || !usingPostgres()) throw new ApiError("Xác thực email/Google chưa được mở. Bạn vẫn có thể đăng nhập bằng tài khoản hiện có.", 503);
  const url = process.env.SUPABASE_URL, publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new ApiError("Xác thực chưa được cấu hình đầy đủ.", 503);
  const jar = await cookies();
  const memory = new Map<string, string>();
  return createClient(url, publishableKey, { auth: {
    flowType: "pkce", autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
    storageKey: "arena-supabase",
    storage: {
      getItem: (key) => key === "arena-supabase-code-verifier" ? jar.get("arena-auth-verifier")?.value ?? null : memory.get(key) ?? null,
      setItem: (key, value) => { if (key === "arena-supabase-code-verifier") jar.set("arena-auth-verifier", value, authCookieOptions); else memory.set(key, value); },
      removeItem: (key) => { if (key === "arena-supabase-code-verifier") jar.delete("arena-auth-verifier"); else memory.delete(key); },
    },
  } });
}

export function providerError(error: { code?: string } | null) {
  if (!error) return;
  const messages: Record<string, string> = {
    email_not_confirmed: "Vui lòng mở email xác nhận tài khoản trước khi đăng nhập.",
    invalid_credentials: "Email hoặc mật khẩu không đúng.",
    user_already_exists: "Email đã được đăng ký. Hãy đăng nhập hoặc đặt lại mật khẩu.",
    over_email_send_rate_limit: "Đã gửi quá nhiều email. Vui lòng đợi rồi thử lại.",
    over_request_rate_limit: "Thao tác quá nhanh. Vui lòng thử lại sau.",
    email_address_not_authorized: "Hệ thống gửi email đang được cấu hình. Vui lòng thử lại sau.",
    provider_disabled: "Đăng nhập Google chưa được mở.",
    validation_failed: "Thông tin xác thực chưa hợp lệ.",
    weak_password: "Mật khẩu chưa đủ mạnh. Hãy dùng mật khẩu khác, tối thiểu 10 ký tự.",
    same_password: "Mật khẩu mới cần khác mật khẩu hiện tại.",
    email_exists: "Không thể sử dụng email này. Hãy chọn địa chỉ khác.",
    otp_expired: "Liên kết xác nhận đã hết hạn hoặc đã được sử dụng. Hãy gửi yêu cầu mới.",
  };
  throw new ApiError(messages[error.code ?? ""] ?? "Không thể xác thực. Vui lòng thử lại hoặc liên hệ quản trị viên.", error.code === "invalid_credentials" ? 401 : 400);
}
