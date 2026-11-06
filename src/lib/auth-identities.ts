import { randomUUID } from "node:crypto";
import type { User as AuthUser } from "@supabase/supabase-js";
import { ApiError } from "./api-error";
import { bumpRevision, namespace, query, sqlTransaction } from "./sql";
import { userFromRow } from "./entity-repository";
import { registrationName } from "./auth-input";

export async function identitySubject(userId: string) {
  const rows = await query("select subject from arena.auth_identities where ns=$1 and user_id=$2", [namespace(), userId]);
  return rows[0]?.subject as string | undefined;
}
export async function resolveIdentity(identity: AuthUser, linkUserId?: string) {
  const email = registrationName.safeParse(identity.email);
  if (!email.success || !identity.email_confirmed_at || identity.is_anonymous) throw new ApiError("Tài khoản cần có email đã được xác minh.", 403);
  // Supabase metadata supplies a display name only. Roles remain in arena.admins.
  const name = String(identity.user_metadata?.full_name ?? identity.user_metadata?.name ?? email.data.split("@")[0]).trim().slice(0,60) || "Thí sinh";
  return sqlTransaction(async client => {
    const ns = namespace();
    const found = await client.query("select u.* from arena.auth_identities i join arena.users u on u.ns=i.ns and u.id=i.user_id where i.ns=$1 and i.subject=$2", [ns, identity.id]);
    if (found.rows[0]) {
      if (found.rows[0].deleted_at || (linkUserId && found.rows[0].id !== linkUserId)) throw new ApiError("Phương thức đăng nhập này đã liên kết với tài khoản khác hoặc không còn khả dụng.", 409);
      return userFromRow(found.rows[0]);
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
    await client.query("insert into arena.auth_identities(ns,subject,user_id,created_at) values($1,$2,$3,$4)",[ns,identity.id,id,Date.now()]);
    await bumpRevision(client);
    return userFromRow((await client.query("select * from arena.users where ns=$1 and id=$2",[ns,id])).rows[0]);
  },true);
}
