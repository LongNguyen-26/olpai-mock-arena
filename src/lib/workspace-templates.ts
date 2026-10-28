import { db, key } from "./db";
import { ApiError } from "./auth";
import type { WorkspaceTemplate } from "./workspace-domain";
import { templateName } from "./template-presentation";

export const templateStore = (owner: string) => key(`gpu:templates:${owner}`);
export async function readTemplates(owner: string) {
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
