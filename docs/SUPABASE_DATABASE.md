# Dữ liệu chính trên Supabase

Phương án đã được người dùng duyệt ngày 05/11/2026. Project `olpai-arena` (`prgbpkscymbihbhtando`), Singapore, Supabase Free. Theo dõi trạng thái cutover trong phần biên bản cuối tệp; không suy mode đang chạy từ Git.

## Phân chia dữ liệu

Supabase Postgres lưu tài khoản và hash scrypt, quyền admin, team/lời mời, catalogue, vòng/run/đăng ký, kết quả/quota/idempotency, thông báo, template và credential đã mã hóa, audit và lịch sử Workspace/chat. Không chuyển sang Supabase Auth và không giải mã rồi mã hóa lại credential khi import.

Upstash Redis vẫn bắt buộc cho cookie session, rate limit, hàng đợi công bằng, reservation, lease/attempt/slot, trạng thái trực tiếp của agent/Hub, ticket một lần và cache hội thoại. Upstash Blob/Drive và CSV fallback đang ở Redis giữ vị trí hiện có. Không chuyển hoặc xóa tệp trong migration database.

SQL là nguồn quyền khi `ARENA_DATABASE_MODE=postgres`. Lua đọc projection riêng dưới `sql:authority:*`, đồng bộ theo revision và khóa giao dịch SQL; không đọc quyền từ key nghiệp vụ Redis cũ. Không tự fallback về Redis khi SQL lỗi. Runtime giữ marker ghi bù lịch sử trong Redis, chỉ xóa marker sau SQL commit; context/budget có thể nạp lại từ SQL khi cache mất, không khởi chạy lại worker job đã mất lease.

## Kết nối và quyền

`ARENA_DATABASE_URL` chỉ có ở backend: role riêng `arena_backend.PROJECT_REF`, transaction pooler `aws-0-ap-southeast-1.pooler.supabase.com:6543`, database `postgres`. Không dùng tài khoản `postgres` trong ứng dụng. Role chỉ có DML ở schema riêng `arena`, RLS theo namespace; schema không phơi qua Data API. Mỗi giao dịch thiết lập namespace bằng `SET LOCAL`, không dùng session state qua transaction pooler. Pool tối đa 3 connection/process, idle 20 giây, connect 10 giây, statement 10 giây và lock 5 giây. TLS kiểm tra certificate/hostname với CA công khai Supabase; không dùng `rejectUnauthorized:false`.

Giữ nguyên `GPU_WORKSPACE_ENCRYPTION_KEY`; URL SQL không dùng tiền tố `NEXT_PUBLIC_`. Env Render được quản lý qua service Dashboard/API; render.yaml là bản tham chiếu, không tự đổi env của service hiện có. Env chỉ có hiệu lực sau deployment. Vercel production phải cùng mode/source với Render; preview dùng namespace và credential riêng.

Các migration trong `supabase/migrations/` khớp lịch sử hosted. Bootstrap đã sinh mật khẩu trong Postgres, ghi một lần vào env bị Git ignore rồi xóa bảng tạm. Không có mật khẩu literal trong migration; cài lại ở project mới phải provision credential riêng trước khi chạy backend. Không chạy lại bootstrap để xoay khóa production.

## Công cụ và backup

Chạy tại repo với Node 24. `.env` chứa Redis/Blob; `.local/supabase-runtime.env` chứa URL SQL. Không đưa hai tệp, backup hoặc `.key` lên Git. Các lệnh sau chỉ là mẫu, phải chọn namespace/path thật trước khi chạy:

```powershell
npx tsx --env-file=.env scripts/database-migrate.ts export --source=arena:v1
npx tsx --env-file=.env --env-file=.local/supabase-runtime.env scripts/database-migrate.ts export-sql --source=arena:v1
npx tsx scripts/database-migrate.ts plan --backup=.local/database-backups/CHOSEN.json.enc
npx tsx --env-file=.env --env-file=.local/supabase-runtime.env scripts/database-migrate.ts import --backup=.local/database-backups/CHOSEN.json.enc --target=arena:stage:CHOSEN --apply
npx tsx --env-file=.local/supabase-runtime.env scripts/database-migrate.ts verify --backup=.local/database-backups/CHOSEN.json.enc --target=arena:stage:CHOSEN
```

Backup AES-256-GCM có checksum, file tạo độc quyền không ghi đè; khóa ở file `.enc.key` cạnh backup trong `.local/database-backups/`. Hai file cùng máy chỉ bảo vệ tránh lộ bản rõ ngẫu nhiên, không thay backup ngoài máy; khi lưu trữ lâu dài phải bảo quản khóa tách khỏi backup và kiểm thử giải mã. Chưa tạo dịch vụ hoặc lịch backup tính phí. Export SQL gồm nghiệp vụ hiện tại và lịch sử còn TTL kể cả khi đã bị Redis evict. Công cụ hiện tại xuất dạng tương thích Redis để rollback; không thay pg_dump toàn schema hoặc PITR và không phục hồi các namespace khác.

Import mặc định dry run, chỉ chèn vào namespace SQL trống, kiểm tra quan hệ trước và toàn bộ row/checksum sau. Production cần thêm `--production`, namespace nguồn khớp và freeze ID chưa đổi. `cleanup-qa --target=arena:stage:CHOSEN --apply` chỉ dọn đúng namespace QA/staging đã chọn; không dọn production.

## Cutover

1. Build/test và rehearsal trên namespace tách biệt. Phát hành code hỗ trợ hai mode lên mọi host còn ghi; lúc này vẫn dùng Redis. Xác minh SHA/deployment thực tế, không chỉ trạng thái push.
2. Kiểm tra không có Workspace đang hoạt động/đang provision hoặc callback cần hoàn tất. Đóng ghi bằng `database-migrate.ts freeze --source=arena:v1 --apply`, lưu freeze ID. Không có TTL tự mở ghi giữa chừng. Route chặn mutation, worker và Hub callback; submission kiểm tra lại sau chấm/upload và Lua chặn commit khi frozen. Dành thời gian cho yêu cầu đã vào trước freeze hoàn tất; kiểm tra dữ liệu ổn định trước export.
3. Export Redis mới khi frozen, backup mã hóa; import một lần vào SQL namespace production và verify tất cả bảng. Không dùng lại snapshot rehearsal cũ.
4. Chuyển env production của các host sang postgres, deploy và xác minh `/api/health` có `database=postgres`, `databaseMigration=1` và đúng commit. Trong thời gian này giữ freeze. Host cũ còn ghi Redis là điều kiện ngăn cutover, không bỏ qua vì hiện đang hết quota hosting.
5. Smoke đăng nhập/catalogue/các vòng/đề/Workspace với credential cũ; kiểm tra lỗi runtime và các host. Mở ghi bằng `unfreeze --source=arena:v1 --freeze-id=EXACT_ID --apply`. Không FLUSHDB hoặc xóa dữ liệu Redis cũ.

Freeze là bảo trì ngắn để chuyển nguồn ghi, không dùng làm trạng thái vận hành thường xuyên. Login/logout vẫn dùng Redis session. Một số GET có thể đọc/materialize trạng thái theo thời gian; freeze chặn materialize Redis và SQL, nhưng không biến toàn ứng dụng thành snapshot read-only tổng quát. Không cutover giữa phiên thi hoặc khi còn tác vụ GPU.

## Rollback sau khi SQL nhận ghi

Đóng ghi lại và xác nhận không còn GPU đang hoạt động. Export SQL hiện tại dưới khóa giao dịch, rồi **dry run và restore dữ liệu nghiệp vụ mới về Redis**, verify trước khi đổi mode các host:

```powershell
npx tsx --env-file=.env --env-file=.local/supabase-runtime.env scripts/database-migrate.ts export-sql --source=arena:v1
npx tsx --env-file=.env scripts/database-migrate.ts restore-business --backup=.local/database-backups/CHOSEN.json.enc --target=arena:v1
npx tsx --env-file=.env scripts/database-migrate.ts restore-business --backup=.local/database-backups/CHOSEN.json.enc --target=arena:v1 --apply --production
```

Restore chỉ thay các key nghiệp vụ được liệt kê rõ của đúng namespace, giữ runtime hiện tại và file. Chỉ đổi mode khi restore verified; lỗi giữa chừng phải giữ freeze và chạy đối soát/restore lại, không mở ghi để chữa lỗi. Không lấy Redis cũ làm authority ngay sau khi SQL đã có bài nộp/tài khoản mới.

## Kiểm thử và vận hành Free

`npm run typecheck`, `npm test`, `npm run build`; tích hợp thật bằng `npx tsx --env-file=.env --env-file=.local/supabase-runtime.env scripts/qa-sql-database.ts`. Script tạo và dọn namespace QA riêng, chặn request provider thật. QA Redis lịch sử cần đặt `ARENA_DATABASE_MODE=redis` riêng; không chạy chúng để nghiệm thu SQL. Không chạy seed/import production để kiểm thử.

Điểm số dùng Postgres float8 với `extra_float_digits=3`, giữ round-trip JS double và tie-break chính xác. Giao dịch khóa ngắn theo namespace cho tải nhỏ; không giữ transaction trong lúc gọi Blob/Runpod/inference. Tăng tải cần đo độ trễ/lock/pool trước khi tăng concurrency. Không tự nâng gói hoặc tạo GPU để QA.

Lịch sử chat/job và request có TTL giữ giới hạn cũ; dọn tối đa 200 bản hết hạn mỗi bảng/giờ có truy cập, không tự xóa lịch sử nghiệp vụ. Submission đã upload nhưng không nhận được xác nhận SQL commit phải giữ file để đối soát idempotency, không tự xóa file có thể thuộc bài đã nhận. Backup/đối soát các asset orphan là thao tác vận hành riêng, không xóa hàng loạt.

Free có giới hạn database/egress và có thể pause khi không hoạt động; Render Free cũng có cold start. Kiểm tra size sau import, giữ backup ngoài project và dùng Dashboard khi cần phục hồi sau pause. Xem [Supabase Free](https://supabase.com/pricing), [database size](https://supabase.com/docs/guides/platform/database-size), [backups](https://supabase.com/docs/guides/platform/backups). SQL/Redis mất kết nối phải hiện lỗi và retry cùng request, không tạo lịch sử thứ hai.

## Biên bản triển khai

- Rehearsal 05/11/2026: 46 users, 18 teams/36 members, 9 packages, 9 rounds, 17 runs, 102 registrations, 245 submissions, 53 quotas, 18 receipts, 14 templates, 2 ciphertext credentials và 2.966 runtime history. Khớp checksum toàn bộ 18 bảng, gồm giá trị điểm chính xác; không ghi production khi rehearsal.
- 95 unit tests qua; typecheck/build production qua trên Windows ngoài sandbox vì Turbopack cần tạo junction. QA 12 nhóm tích hợp SQL/Redis gồm tranh chấp quota/team/reservation, provider giả lập, Hub ticket, callback đến muộn, mất cache, SQL rollback/replay và backup/restore qua. Không kiểm thử GPU thật và không tạo tài nguyên trả phí.
- Smoke HTTP trên staging: đăng nhập bằng hash cũ, đọc 6 vòng hiển thị/đề, 239 bài thuộc run đang hiển thị, roster và 98 Workspace qua; logout dọn session. Đã sửa việc đọc lặp SQL làm cạn hàng đợi pool khi tải lịch sử lớn bằng cách gom dữ liệu và gộp truy vấn trùng trong đúng một response đọc; không cache quyền giữa các request.
- **Chưa cutover production**: Vercel trả `402 resource_creation_blocked` khi thêm env do team vượt fair-use; bản Vercel production vẫn là code cũ. Không thể coi host này đã chuyển SQL chỉ vì hiện runtime trả 402. Render đã được thêm URL SQL server-only nhưng giữ mode Redis; không thay khóa mã hóa hiện có. Chờ khả năng cập nhật/đồng nhất host hoặc quyết định xử lý host cũ trước khi freeze/import production.
