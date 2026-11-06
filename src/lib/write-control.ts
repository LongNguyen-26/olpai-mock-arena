import { db,key } from "./db";
import { ApiError } from "./api-error";
import { usingPostgres } from "./sql";
import { sqlWritable } from "./entity-repository";

/** Shared gate used by every updated deployment during the final migration. */
export async function assertWritesAllowed() {
  if(usingPostgres()) { await sqlWritable(); return; }
  if(await db().get(key("database:write-freeze"))) throw new ApiError("Hệ thống đang chuyển dữ liệu. Vui lòng thử lại sau.",503);
}
