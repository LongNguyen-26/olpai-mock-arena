<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Dự án và cách làm việc

- Website Next.js App Router/React/TypeScript; Node.js 24. Repo `LongNguyen-26/olpai-mock-arena`, nhánh production `main`; web: `https://olpai-mock-arena.vercel.app`. Xác minh remote, SHA, project/team và trạng thái cloud trước mỗi lần phát hành; các ghi chép cũ không phải trạng thái hiện tại.
- Đọc `git status`/diff trước khi sửa. Giữ thay đổi của người dùng/session khác; chỉ stage phần của mình, không dùng `git add .`, reset hoặc deploy cả working tree đang lẫn việc khác. Không sửa notebook/dự án luyện thi bên ngoài repo. Làm tiếp trong phạm vi đã được người dùng cho phép, không hỏi lại các bước đã được duyệt.
- Điểm vào: `src/components/` là UI; `src/app/api/` là HTTP; `src/lib/` chứa quyền, vòng thi, dữ liệu và Workspace; `gpu-workspace/` là runtime trên Pod. Quyền phải kiểm tra ở server, không chỉ ẩn nút UI. Giữ ranh giới public/private và run sau khi reset vòng.
- Khi chuẩn hóa đề, ZIP hoặc notebook, đọc `docs/DATASET_PACKAGING.md`: giữ nguồn cũ, đề tách khỏi dữ liệu, notebook gọn không EDA/lời nhắc; ghi chú triển khai ở ngoài đề. Chỉ nạp catalogue quản trị trừ khi người dùng yêu cầu phát hành vòng.
- Không commit/in log `.env*`, `ACCESS.local.md`, `.local/`, cookie, token, signed URL. Khóa mã hóa `GPU_WORKSPACE_ENCRYPTION_KEY` phải ổn định, không tự sinh đè; mất khóa sẽ không giải mã được Runpod credential đã lưu. Xem tên biến trong `.env.example`; không dùng `NEXT_PUBLIC_` cho secret.

## Kiểm tra và phát hành

- Thông thường: `npm ci` khi thiếu/đổi dependencies; `npm run typecheck`, `npm test`, `npm run build`. Không chạy seed/import/migration trên production để thử UI. Xem luồng vận hành trong `docs/ROUND_OPERATIONS.md`, kết quả kiểm tra trong `docs/verification.md`.
- Thay đổi GPU runtime: thêm `python gpu-workspace/test_agent.py -q` (CPU, không chứng minh GPU chạy). Luồng Workspace/Redis: `npx tsx --env-file=.env scripts/qa-workspace-flow.ts` tự tạo namespace QA mới, giả lập Runpod và tự dọn; `--keep` chỉ dùng khi cần fixture cho `qa-workspace-http.ts` (xem đầu script).
- Redis/Blob dùng Upstash. Namespace mặc định `arena:v1` là dữ liệu thật; QA/preview phải tách namespace, Blob prefix hoặc database. Không `FLUSHDB`, không dọn key/asset ngoài phạm vi QA của chính lần chạy; khóa/idempotency phải kiểm tra bằng yêu cầu đồng thời khi sửa provisioning/nộp bài.
- Kiểm tra trình duyệt bằng Playwright: desktop + mobile nếu đổi bố cục; theo dõi request/response và lỗi console. Mock provider/mutation để thử cấp GPU, không tạo Pod tính phí chỉ để QA. Lưu ảnh ở `output/playwright/`, auth state ở `.local/`, đăng xuất và dọn auth state sau kiểm tra; không đưa trace có secret lên Git. Báo rõ phần giả lập và phần đã kiểm tra thật.
- Git push lên `main` kích hoạt Vercel Git integration. Chỉ phát hành phần đã kiểm tra, không cần deploy CLI lần nữa. Ưu tiên Vercel connector để xem deployment/log; xác nhận deployment đúng **full SHA**, target production và `READY`, rồi smoke URL thật. `npx tsx scripts/smoke-gpu-production.ts` kiểm tra login/API/config, không cấp Pod (cần file access local). Có lỗi build thì đọc log, sửa rồi kiểm tra lại; không coi push thành công là deploy thành công.
- Docker Hub: `nguyenlong26/olpai-workspace`; workflow `.github/workflows/gpu-workspace-image.yml` dùng repository secret `DOCKERHUB_TOKEN`. Build/push qua GitHub Actions vì image CUDA lớn, máy local từng đầy ổ C. Runtime-only dùng `Dockerfile.runtime`; đổi dependencies/base cần full build. Chờ job publish thành công, lấy digest từ summary và ghim `image@sha256:…` cho **Pod mới**, đồng bộ `RUNPOD_WORKSPACE_IMAGE` trên Vercel production và template lưu trong Redis khi có thay đổi image; env mới chỉ có hiệu lực sau deployment mới. Web-only không cần rebuild image.

## GPU Workspace / Runpod

- Trước khi sửa provider, provisioning hoặc startup, đọc `docs/RUNPOD_TROUBLESHOOTING.md` và `docs/GPU_WORKSPACE.md`; đây là ghi chép lỗi đã gặp, không được suy trạng thái cloud hiện tại từ log cũ.
- Kiểm tra GraphQL errors cả khi HTTP 200; đối soát trước retry khi kết quả tạo Pod chưa rõ. Không log khóa, env Pod, cookie hoặc signed URL. Chưa có Pod ID thì không tính chi phí giả.
- Không lấy RUNNING hay trang login 200 làm bằng chứng Jupyter/model sẵn sàng. Kiểm tra proxy, Origin và kernel browser thật; giữ auth/XSRF, không mở wildcard để chữa readiness.
- Reset round phải cập nhật run binding và vòng đời model; lịch sử/token của Pod chung phải tách theo đội/run. Pod cũ mặc định team/both và cần tương thích reservation cũ.
- Chat mặc định dùng UUID lưu trong `sessionStorage` theo Pod: riêng mỗi máy/tab, refresh giữ nguyên; “Đoạn chat mới” hoặc `/new` đổi UUID và xóa phần hiển thị. Không dùng Pod ID hoặc `localStorage` làm ID mặc định. Giữ `rel="noopener noreferrer"` khi mở tab Chatbot để tab mới không sao chép sessionStorage từ opener. Khi sửa, kiểm tra hai tab, refresh, chat mới và response cũ đến muộn.
- QA chat có sẵn: mở URL web bằng Playwright CLI rồi `run-code --filename scripts/qa-chat-sessions.js` trong cùng session; script giả lập API chat, kiểm tra hai tab/hai browser context, refresh và chat mới, không gọi model thật.
- Build image qua GitHub Actions, ghim digest; không tự đổi/restart/thu hồi Pod đang dùng để triển khai tính năng cho Pod mới. Nếu cần sửa Pod thật, kiểm tra kernel/mount trước và giữ `/workspace`.
- Provision qua payload GraphQL trong `src/lib/runpod.ts`, đọc cả lỗi HTTP 200 và phân biệt hết stock/validation/mất xác nhận. Giá catalog không chứng minh còn GPU; không retry create khi chưa đối soát. Jupyter ở 8888, agent/LLM ở 8000; readiness cần kiểm tra `/lab` có auth và kernel/WebSocket thật, `/api/status` công khai chỉ là probe tối thiểu. Model phải trả VRAM khi private và tự nạp lại khi public; đối chiếu log, stage, GPU telemetry và inference giới hạn khi cần.
