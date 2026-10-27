<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## GPU Workspace / Runpod

- Trước khi sửa provider, provisioning hoặc startup, đọc `docs/RUNPOD_TROUBLESHOOTING.md` và `docs/GPU_WORKSPACE.md`; đây là ghi chép lỗi đã gặp, không được suy trạng thái cloud hiện tại từ log cũ.
- Kiểm tra GraphQL errors cả khi HTTP 200; đối soát trước retry khi kết quả tạo Pod chưa rõ. Không log khóa, env Pod, cookie hoặc signed URL. Chưa có Pod ID thì không tính chi phí giả.
- Không lấy RUNNING hay trang login 200 làm bằng chứng Jupyter/model sẵn sàng. Kiểm tra proxy, Origin và kernel browser thật; giữ auth/XSRF, không mở wildcard để chữa readiness.
- Reset round phải cập nhật run binding và vòng đời model; lịch sử/token của Pod chung phải tách theo đội/run. Pod cũ mặc định team/both và cần tương thích reservation cũ.
- Build image qua GitHub Actions, ghim digest; không tự đổi/restart/thu hồi Pod đang dùng để triển khai tính năng cho Pod mới. Nếu cần sửa Pod thật, kiểm tra kernel/mount trước và giữ `/workspace`.
