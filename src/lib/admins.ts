import { db, key } from "./db";

/** Preserve the original administrator while supporting additional accounts. */
export async function getAdminIds(): Promise<string[]> {
  const [primary, additional] = await Promise.all([
    db().get<string>(key("admin")),
    db().smembers<string[]>(key("admins")),
  ]);
  return [...new Set([...(primary ? [primary] : []), ...additional])];
}
