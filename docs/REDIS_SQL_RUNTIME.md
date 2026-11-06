# Core/Groq SQL và Runpod Redis

Quyết định ngày 06/11/2026: triển khai phương án B, với phạm vi đã được người dùng làm rõ: **Runpod tiếp tục dùng Redis như cũ**, không xây backend SQL thay thế cho Runpod. **Jupyter-only và JupyterHub cũng thuộc nhánh Runpod này**; chưa dùng thường xuyên nên giữ lại để refactor sau nếu cần.

## Phân chia dữ liệu

- Core: Supabase Postgres giữ nghiệp vụ, cookie session dạng hash token, expiry 7 ngày, limiter và maintenance gate. Không đổi scrypt, cookie hay khóa mã hóa credential.
- Groq: SQL là nguồn ghi cho group, hội thoại, job, token reservation, attempt/lease, fairness giữa audience và kết quả đã nhận. Dùng `arena.runtime_history` trực tiếp để giữ hội thoại/ID cũ; bảng `chat_lanes` lưu lượt phục vụ. Không dùng SQL để mô phỏng Redis/Lua.
- Namespace policy/reset dùng exclusive advisory transaction lock; Groq runtime dùng shared policy fence rồi khóa group/request/audience cần thiết. Không giữ transaction khi gọi inference. Phiên đã prepare không được prepare lại để gửi inference lần hai.
- Kết quả được lưu trước finalize; restart có thể finalize lại kết quả đó. Job đã gửi mà chưa có xác nhận chuyển `uncertain`, giữ ngân sách và không tự gọi model lại. 429/từ chối rõ ràng mới được hoàn reservation; retry 429 có giới hạn ba lần.
- Session, limiter, lease và signal đều kiểm tra expiry khi dùng; cleanup theo batch mỗi giờ khi runner hoạt động chỉ dọn dung lượng. Hội thoại lưu lâu dài, job giữ thời hạn 30 ngày như trước.
- File chính vẫn ở Blob/Drive. CSV fallback nhỏ dùng `arena.submission_files` (gzip, giới hạn theo file nộp), metadata `fileStorage=postgres`. Không chuyển dataset/model vào SQL.
- Runpod provisioning, worker, Hub ticket, GPU turn và Jupyter vẫn dùng Redis. Snapshot/history SQL đọc độc lập; replay marker Runpod nằm ở đường runtime write hoặc thao tác `syncRuntimeHistory()` rõ ràng, không phải điều kiện để đọc lịch sử Groq.

## Chế độ Runpod

`ARENA_RUNPOD_MODE` có ba giá trị server-only:

| Giá trị | Hành vi |
|---|---|
| `enabled` | Mặc định tương thích cũ; Runpod/Jupyter/Hub cần Redis |
| `draining` | Chặn cấp phát/prompt/phiên notebook mới, vẫn nhận callback hợp lệ và cho xử lý công việc cũ |
| `disabled` | Chặn API Runpod/Jupyter/Hub, không đọc Redis cho core/Groq; UI chuyển sang Groq, giữ lịch sử SQL |

Không tự dừng/xóa Pod khi đổi mode. Chỉ dùng `disabled` sau khi đối soát hết Pod, queued/claimed/running/uncertain job và marker ghi bù. Khi bật lại phải cấp đúng Redis credential cũ và deploy; đây là một thay đổi vận hành, không phải feature flag cho thí sinh. Khi Runpod đang bật, các thao tác thuộc Runpod vẫn có thể lỗi nếu Redis lỗi.

Groq runner tiếp tục chạy trong Node trên Render, safety poll 5 giây, được đánh thức sau enqueue. Nhóm pause và không còn job cần xử lý không được pump thường xuyên. Render Free vẫn có idle sleep; chưa có worker độc lập hoặc bảo đảm chạy 24/7. Quay về Vercel vẫn phải chọn nơi chạy executor phù hợp; không bật Redis cũ để thay nguồn dữ liệu SQL.

## Migration và cutover

Migration `20261106022549_optional_runpod_sql_runtime.sql` thêm sáu bảng private có RLS namespace, grant backend và index cho job đang hoạt động. Migration đã áp dụng; security advisors không có cảnh báo mới.

Các lệnh sau chọn namespace production rõ ràng. Không chạy giữa phiên GPU hoặc khi còn inference cần đối soát:

```powershell
node node_modules/tsx/dist/cli.mjs --env-file=.env --env-file=.local/supabase-runtime.env scripts/cutover-sql-runtime.ts
node node_modules/tsx/dist/cli.mjs --env-file=.env --env-file=.local/supabase-runtime.env scripts/database-migrate.ts freeze --source=arena:v1 --apply
node node_modules/tsx/dist/cli.mjs --env-file=.env --env-file=.local/supabase-runtime.env scripts/cutover-sql-runtime.ts --apply --production --freeze-id=EXACT_ID
```

Dry-run kiểm tra active runtime cả SQL/Redis và SHA-256 của CSV fallback. Apply yêu cầu đúng SQL freeze ID, tạo backup mã hóa trước/sau, sao chép session còn hạn, đổi pointer CSV sau lưu SQL và đối chiếu byte. **Không xóa bất kỳ key Redis nào**. Backup, khóa và proof nằm ở `.local/`, không đưa lên Git.

Sau đó deploy code và env `ARENA_RUNPOD_MODE=disabled`; Redis credential có thể để trống khi không dùng Runpod. Giữ Blob token, SQL URL và khóa mã hóa nguyên vẹn. Smoke health/login/catalogue/Workspace/history/download rồi mở ghi đúng freeze ID:

```powershell
node node_modules/tsx/dist/cli.mjs --env-file=.env --env-file=.local/supabase-runtime.env scripts/database-migrate.ts unfreeze --source=arena:v1 --freeze-id=EXACT_ID --apply
```

Freeze/unfreeze trong mode postgres dùng maintenance và ID ở SQL; không còn dựa vào Redis freeze key. Một số job/phase materialization bị chặn trong thời gian bảo trì. Nếu fail, giữ maintenance để đối soát; không đổi về mode Redis nhằm chữa lỗi.

## Backup và khôi phục

`export-sql` ở mode Runpod disabled không cần Redis; backup mã hóa bao gồm session, limiter, lease/signal, lane và CSV gzip. Import/verify hỗ trợ các bảng này, đã rehearsal trên namespace QA khác và khôi phục đúng byte CSV. Đây vẫn là backup ứng dụng theo namespace, không thay pg_dump/PITR toàn project.

Snapshot có `sqlRuntime` phải khôi phục vào SQL. Công cụ chặn production restore-business sang Redis cho snapshot này vì đổi mode không thể rollback session/Groq/file state mới. Khi Runpod bật, backup vẫn thu thập runtime Redis; replay marker trước freeze, hoặc xác minh marker trống nếu đã frozen.

## Kiểm tra đã thực hiện

- Typecheck, 107 unit tests và production build local qua. Cần build lại nếu có thay đổi sau mốc kiểm tra cuối.
- `scripts/qa-sql-groq.ts`: SQL thật, không Redis credential; enqueue trùng/cạnh tranh, slot, token, stale attempt, result replay, session/limiter/lease, Workspace/history/CSV và backup/restore; provider giả lập, không có network ngoài dự kiến.
- `scripts/qa-groq-flow.ts`: SQL thật, không Redis; 429, từ chối, timeout, hai slot, private chặn phản hồi muộn, đổi key và export mã hóa. 13 inference giả lập, 0 inference thật.
- `scripts/qa-sql-database.ts`: hồi quy Runpod/Hub với Redis thật trong namespace QA; provisioning giả lập, ticket một lần, quota/idempotency, quyền và replay; không tạo Pod.
- HTTP bản production QA không có Redis: login/logout/session, arena, Workspace/history và cấu hình Groq; API Runpod bị chặn đúng mode.
- Playwright desktop/mobile: mode Runpod disabled, giao diện Groq, hai tab/refresh/chat mới. Luồng browser → API thật → SQL thật → worker/Groq giả lập → SQL → browser và refresh giữ phản hồi qua; đã xem ảnh ở `output/playwright/sql-runtime-*.png`.

Chưa đo tải nhiều đội đồng thời hoặc inference/GPU thật. Không suy số user hỗ trợ hoặc phần trăm tăng tốc từ các kiểm thử chức năng.

## Trạng thái phát hành

Đang chuẩn bị cutover/deploy Render. Chưa đổi billing, không xóa Upstash database và không sửa Vercel. Biên bản production sẽ bổ sung sau khi xác minh SHA live và smoke thành công.
