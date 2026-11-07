import { ApiError } from "./api-error";
import { namespace, query, usingPostgres } from "./sql";

// Only booleans leave the private database function. Never load password hashes
// or infer password availability from an email identity / user-editable metadata.
export async function accountAuthMethods(userId: string) {
  if (!usingPostgres()) return { emailVerified: false, passwordEnabled: true, googleLinked: false };
  const row = (await query(`select u.password_hash <> 'external:supabase' as legacy,
    s.email_verified,s.password_enabled,s.google_linked
    from arena.users u left join lateral arena.account_auth_state(u.id) s on true
    where u.ns=$1 and u.id=$2 and u.deleted_at is null`, [namespace(), userId]))[0];
  return { emailVerified: !!row?.email_verified, passwordEnabled: !!(row?.legacy || row?.password_enabled), googleLinked: !!row?.google_linked };
}

export async function requirePasswordAccount(userId: string) {
  const methods = await accountAuthMethods(userId);
  if (!methods.passwordEnabled || !methods.emailVerified)
    throw new ApiError("Tài khoản chưa có mật khẩu. Hãy đăng nhập bằng Google hoặc email một lần, rồi thiết lập mật khẩu trong Tài khoản.", 403);
  return methods;
}
