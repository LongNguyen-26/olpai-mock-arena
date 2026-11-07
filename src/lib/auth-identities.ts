import { randomUUID } from "node:crypto";
import type { User as AuthUser } from "@supabase/supabase-js";
import { ApiError } from "./api-error";
import { bumpRevision, namespace, query, sqlTransaction } from "./sql";
import { userFromRow } from "./entity-repository";
import { profileName, registrationName } from "./auth-input";
import { syncVerifiedIdentityEmail } from "./account-profile";

export async function identitySubject(userId: string) {
  const rows = await query("select subject from arena.auth_identities where ns=$1 and user_id=$2", [namespace(), userId]);
  return rows[0]?.subject as string | undefined;
}
export async function identityNeedsName(userId: string) {
  const rows = await query("select needs_name from arena.auth_identities where ns=$1 and user_id=$2", [namespace(),userId]);
  return !!rows[0]?.needs_name;
}
export async function completeIdentityName(userId: string, value: unknown) {
  const name = profileName.parse(value);
  return sqlTransaction(async client => {
    const ns = namespace();
    const changed = await client.query("update arena.auth_identities set needs_name=false,name_confirmed_at=$3 where ns=$1 and user_id=$2 and needs_name=true returning subject",[ns,userId,Date.now()]);
    if (!changed.rowCount) throw new ApiError("Tên tài khoản đã được hoàn tất. Hãy tải lại trang.",409);
    const user = await client.query("update arena.users set name=$3 where ns=$1 and id=$2 and deleted_at is null returning id",[ns,userId,name]);
    if (!user.rowCount) throw new ApiError("Tài khoản không còn khả dụng.",401);
    await bumpRevision(client);
  },true);
}
export async function resolveIdentity(identity: AuthUser, linkUserId?: string) {
  const email = registrationName.safeParse(identity.email);
  if (!email.success || !identity.email_confirmed_at || identity.is_anonymous) throw new ApiError("Tài khoản cần có email đã được xác minh.", 403);
  const google = identity.app_metadata?.provider === "google";
  // Google names are entered explicitly in Arena. Email signup already asks for a name.
  const enteredName = profileName.safeParse(identity.user_metadata?.name);
  const name = !google && enteredName.success ? enteredName.data : "Thí sinh";
  await syncVerifiedIdentityEmail(identity);
  return sqlTransaction(async client => {
    const ns = namespace();
    const found = await client.query("select u.*,i.needs_name,i.name_confirmed_at from arena.auth_identities i join arena.users u on u.ns=i.ns and u.id=i.user_id where i.ns=$1 and i.subject=$2", [ns, identity.id]);
    if (found.rows[0]) {
      if (found.rows[0].deleted_at || (linkUserId && found.rows[0].id !== linkUserId)) throw new ApiError("Phương thức đăng nhập này đã liên kết với tài khoản khác hoặc không còn khả dụng.", 409);
      if(google)await client.query("update arena.auth_identities set google_account=true where ns=$1 and subject=$2",[ns,identity.id]);
      // Google accounts created before onboarding was introduced confirm their name once.
      const needsName = found.rows[0].needs_name || (google && found.rows[0].name_confirmed_at == null && found.rows[0].password_hash === "external:supabase");
      if (needsName && !found.rows[0].needs_name) {
        await client.query("update arena.auth_identities set needs_name=true where ns=$1 and subject=$2",[ns,identity.id]);
        await bumpRevision(client);
      }
      return {...userFromRow(found.rows[0]),needsName:!!needsName};
    }
    let id = linkUserId;
    if (id) {
      const local = await client.query("select * from arena.users where ns=$1 and id=$2 and deleted_at is null", [ns,id]);
      if (!local.rows[0]) throw new ApiError("Hãy đăng nhập lại trước khi liên kết.",401);
      if ((await client.query("select 1 from arena.auth_identities where ns=$1 and user_id=$2",[ns,id])).rowCount) throw new ApiError("Tài khoản đã có phương thức Supabase khác. Không thể tự thay đổi liên kết.",409);
    } else {
      const existing = await client.query("select id from arena.users where ns=$1 and lower(username)=$2 and deleted_at is null", [ns,email.data]);
      if (existing.rowCount) throw new ApiError("Email trùng tài khoản Arena hiện có. Hãy đăng nhập bằng mật khẩu cũ, rồi liên kết Google trong mục Tài khoản.",409);
      id = randomUUID();
      await client.query("insert into arena.users(ns,id,username,name,password_hash,team_id,created_at) values($1,$2,$3,$4,'external:supabase',null,$5)",[ns,id,email.data,name,Date.now()]);
    }
    const needsName = !linkUserId && google;
    await client.query("insert into arena.auth_identities(ns,subject,user_id,created_at,needs_name,name_confirmed_at,google_account) values($1,$2,$3,$4,$5,$6,$7)",[ns,identity.id,id,Date.now(),needsName,needsName?null:Date.now(),google]);
    await bumpRevision(client);
    return {...userFromRow((await client.query("select * from arena.users where ns=$1 and id=$2",[ns,id])).rows[0]),needsName};
  },true);
}
