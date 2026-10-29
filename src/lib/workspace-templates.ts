import { db, key } from "./db";
import { ApiError } from "./auth";
import type { WorkspaceTemplate } from "./workspace-domain";
import { templateName } from "./template-presentation";
import { randomUUID } from "node:crypto";

export const templateStore = (owner: string) => key(`gpu:templates:${owner}`);
export const sharedTemplateStore = () => key("gpu:templates:shared");
export async function readTemplates(owner: string) {
  if (await db().exists(key("gpu:templates:shared:ready")))
    return (
      (await db().hgetall<Record<string, WorkspaceTemplate>>(
        sharedTemplateStore(),
      )) ?? {}
    );
  const own = await db().hgetall<Record<string, WorkspaceTemplate>>(
    templateStore(owner),
  );
  return (
    own ??
    (await db().hgetall<Record<string, WorkspaceTemplate>>(
      key("gpu:templates"),
    )) ??
    {}
  );
}
export async function saveSharedTemplate(
  t: WorkspaceTemplate,
  owner: string,
  options: { overwrite?: boolean; expectedRevision?: string },
) {
  const snapshot = await db().eval<
    unknown[],
    { version: string; values: string[] }
  >(
    "return cjson.encode({version=redis.call('GET',KEYS[1]) or '0',values=redis.call('HGETALL',KEYS[2])})",
    [key("gpu:templates:version"), sharedTemplateStore()],
    [],
  );
  const values = snapshot.values;
  const saved: Record<string, WorkspaceTemplate> = {};
  for (let i = 0; i < values.length; i += 2)
    saved[values[i]] = JSON.parse(values[i + 1]);
  // Until the explicit reset migration, seed from the legacy catalogue once.
  const catalogue = (await db().exists(key("gpu:templates:shared:ready")))
    ? saved
    : await readTemplates(owner);
  validateTemplateSave(
    t,
    catalogue,
    !!options.overwrite,
    options.expectedRevision,
  );
  const now = Date.now(),
    old = catalogue[t.id];
  const next = {
    ...t,
    revision: randomUUID(),
    createdBy: old?.createdBy ?? owner,
    createdAt: old?.createdAt ?? now,
    updatedBy: owner,
    updatedAt: now,
  };
  const fields = Object.entries({ ...catalogue, [next.id]: next }).flatMap(
    ([id, value]) => [id, JSON.stringify(value)],
  );
  const ok = await db().eval(
    "if (redis.call('GET',KEYS[1]) or '0')~=ARGV[1] then return 0 end;for i=2,#ARGV,2 do redis.call('HSET',KEYS[2],ARGV[i],ARGV[i+1]) end;redis.call('INCR',KEYS[1]);redis.call('SET',KEYS[3],'1');return 1",
    [
      key("gpu:templates:version"),
      sharedTemplateStore(),
      key("gpu:templates:shared:ready"),
    ],
    [snapshot.version, ...fields],
  );
  if (!ok)
    throw new ApiError(
      "Template đã được admin khác cập nhật. Tải lại trước khi lưu.",
      409,
    );
  return next;
}
export function validateTemplateSave(
  t: WorkspaceTemplate,
  saved: Record<string, WorkspaceTemplate>,
  overwrite: boolean,
  expectedRevision?: string,
) {
  if (
    Object.values(saved).some(
      (s) => s.id !== t.id && templateName(s.name) === templateName(t.name),
    )
  )
    throw new ApiError(
      "Tên template đã được sử dụng. Đặt tên khác cho cấu hình mới.",
      409,
    );
  const old = saved[t.id];
  if (old && !overwrite)
    throw new ApiError(
      "Template đã tồn tại. Cần xác nhận trước khi ghi đè.",
      409,
    );
  if (old && expectedRevision !== (old.revision ?? "legacy"))
    throw new ApiError(
      "Template đã được thay đổi từ cửa sổ khác. Tải lại và kiểm tra trước khi ghi đè.",
      409,
    );
  if (!old && overwrite)
    throw new ApiError(
      "Template không còn tồn tại. Tải lại danh sách trước khi lưu.",
      409,
    );
}
