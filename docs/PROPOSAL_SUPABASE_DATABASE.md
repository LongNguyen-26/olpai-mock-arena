# Đề xuất chuyển database chính sang Supabase Free

Trạng thái: **người dùng đã duyệt implement** ngày 05/11/2026. Đây là bản phân tích tại thời điểm duyệt; trạng thái triển khai và hướng dẫn hiện tại ở [SUPABASE_DATABASE.md](SUPABASE_DATABASE.md). Code được khảo sát: `82191308362138232252ae5df57356de9527f093`.

Mục tiêu đã được người dùng chọn: Supabase là nơi lưu dữ liệu chính; Redis tiếp tục hỗ trợ vận hành. Trong lượt phân tích chỉ đọc source, metadata Redis và trạng thái Supabase; chưa tạo schema, cài dependency, sao chép dữ liệu hay đổi cấu hình cloud. Các script/thống kê khảo sát nằm trong `.local/`, không chứa nội dung bản ghi trong báo cáo.

## 1. Những gì đã xác minh

Supabase:

- Org `OlpAI Arena`, ID `iudnhdxjrxlniqvqetcs`, gói **Free**.
- Project `olpai-arena`, ref `prgbpkscymbihbhtando`, vùng `ap-southeast-1` (Singapore), `ACTIVE_HEALTHY`.
- Postgres 17.11; chưa có bảng trong `public`, chưa có user Supabase Auth hoặc object Supabase Storage.
- Database `postgres` được truy vấn đang dùng khoảng 11,1 MB, trước khi thêm dữ liệu ứng dụng. Đây không phải đo toàn bộ disk/WAL của cluster.

Redis production, namespace `arena:v1`, thống kê lúc khoảng 13:37 ngày 05/11/2026 (giờ Việt Nam):

| Nhóm | Đo được |
| --- | ---: |
| Toàn bộ key trong namespace | 3.346 |
| Tài khoản | 46 |
| Team | 18 |
| Vòng trong danh sách hiện hành | 6 |
| Bản ghi round / snapshot run lịch sử | 8 / 17 |
| Bản ghi package / mục catalogue | 9 / 5 |
| Đăng ký vòng | 102 |
| Bản ghi bài nộp, gồm mọi loại hiện có | 245 |
| Key đếm quota nộp | 53 |
| Workspace / nhóm Chatbot | 98 / 8 |
| Hội thoại có TTL / job có TTL | 1.356 / 1.504 |
| Credential Runpod đã mã hóa | 2 |
| File bài nộp đang dùng Redis fallback | 1 |

Tổng độ dài các giá trị kiểu string khoảng 13,8 MB; hội thoại và job chiếm khoảng 96,5% phần này. Phép đo **không gồm payload bên trong hash/list/set, overhead Redis hoặc kích thước sau chuyển sang Postgres**; SCAN cũng không phải snapshot nhất quán khi hệ thống đang có ghi. Chưa thể dùng số này làm dự báo chính xác dung lượng SQL hoặc mức tiết kiệm Redis.

Các chênh lệch giữa danh sách hiện hành và bản ghi vật lý có thể là dữ liệu lịch sử/legacy. Không coi đó là dữ liệu rác và không xóa trong migration.

## 2. Ranh giới dữ liệu đề xuất

| Nhóm | Nơi lưu sau migration | Ghi chú |
| --- | --- | --- |
| User, password hash, admin, team, thành viên, mã/lời mời | Supabase Postgres | Giữ nguyên UUID và scrypt hash; giữ cách đăng nhập hiện tại |
| Package, đề, metadata asset và vị trí bộ chấm | Supabase Postgres | Metadata và nội dung đề; file/bộ chấm vẫn ở Blob/Drive |
| Round, lịch, quyền public/private, revision, run và snapshot lịch sử | Supabase Postgres | Tách vòng ổn định khỏi từng lượt chạy/reset |
| Đăng ký/duyệt, thông báo, audit nghiệp vụ | Supabase Postgres | Giữ lịch sử, trạng thái và mốc thời gian |
| Bài nộp, điểm, quota nộp, request chống nộp trùng | Supabase Postgres | Ghi nhận cùng transaction; bảng xếp hạng lấy từ dữ liệu này |
| Template GPU, cấu hình nhóm, credential mã hóa, metadata và lịch sử Workspace/chi phí | Supabase Postgres | Giữ khóa mã hóa cũ; runtime có thể giữ bản chiếu Redis cần thiết |
| Lịch sử chat/job đã hoàn tất và mức sử dụng token cần lưu | Supabase Postgres | Giữ thời hạn hiện có; không tự biến TTL 30 ngày thành lưu vô hạn |
| Session đăng nhập, rate limit, ticket Hub dùng một lần | Redis | Dữ liệu ngắn hạn có TTL |
| Queue, fairness, lease/attempt, heartbeat, slot/pending, khóa điều phối, trạng thái GPU/Hub đang chạy | Redis | Redis tiếp tục là bộ điều phối runtime; trạng thái cần lưu lâu dài được ghi nhận vào SQL |
| Ngữ cảnh chat đang dùng, cache giá/capacity, cache đọc có version | Redis | Dữ liệu tạm/cache; không là nguồn quyết định quyền nghiệp vụ |
| Dataset, checkpoint, truth, file CSV và link Drive | Upstash Blob/Drive hiện tại | Chưa chuyển sang Supabase Storage trong phạm vi này |

Một file Redis fallback cũ vẫn phải tải được theo metadata hiện tại. Giữ đường đọc tương thích và không xóa file này. Chuyển object storage hoặc thay cơ chế fallback là phạm vi riêng, tránh âm thầm dồn binary vào quota 500 MB của Postgres.

## 3. Phần bắt buộc phải refactor

Hiện có 20 module production liên quan Redis/Lua. Không thay `db()` bằng một lớp giả Redis trên Postgres và cũng không sao chép mọi key vào một bảng JSON chung rồi coi là đã chuyển database.

**Nộp bài:** `SUBMIT_SCRIPT` trong `src/lib/arena.ts` đang kiểm tra run, vai trò, team, đăng ký, thời gian, quota, chống trùng và ghi bài nộp trong cùng Lua script. Các phần này chuyển cùng nhau sang transaction Postgres, với unique constraint cho request và khóa/cập nhật có điều kiện cho quota. Không để SQL giữ kết quả còn Redis là nguồn chính của quota nộp. Admin test và bài invalid phải giữ đúng cách tính hiện tại.

**Team và vòng thi:** chuyển thao tác thêm/rời team, giới hạn 3 người, đổi đội trưởng, duyệt đăng ký, thay quyền, mở private và reset sang transaction có khóa/version. Giữ `roundId`, `runId`, `revision`, `chatEpoch`, phân biệt public/private và chế độ giữ bảng điểm sau reset. Dùng giờ database để quyết định mốc nghiệp vụ; đối chiếu với đồng hồ runtime Redis và không trộn hai nguồn giờ trong cùng một quyết định.

**GPU/Chatbot/Hub:** Lua hiện trực tiếp đọc user, admin, team, đăng ký và round trong Redis. Sau migration phải thay ranh giới kiểm tra này: API admission, worker claim/prepare/complete và Hub authorize/redeem kiểm tra quyền/run/epoch từ SQL trước khi cấp quyền hoặc trả kết quả. Bản chiếu Redis không được tự cấp lại quyền đã thu hồi. Ngữ cảnh/lease/slot vẫn xử lý nguyên tử trong Redis.

Các thao tác đi qua hai hệ thống cần ID yêu cầu ổn định, trạng thái chờ đồng bộ và cơ chế đối soát/retry có lưu trạng thái (ví dụ transactional outbox phía SQL), không dùng hai lệnh ghi rời rồi giả định cả hai luôn thành công. Không giữ SQL transaction mở trong lúc gọi Runpod, chấm bài, tải Blob hoặc chạy model. Không cấp lại Pod hoặc chạy lại inference khi kết quả lần trước chưa xác định; giữ quy trình đối soát hiện có.

Redis queue và SQL ledger có thể cập nhật khác thời điểm, nhưng request chưa được xác nhận quyền/đồng bộ không được trở thành tác vụ được phép chạy. SQL unique/version là lớp kiểm tra cuối cho nghiệp vụ; Redis lock chỉ hỗ trợ điều phối, không thay thế ràng buộc SQL.

## 4. Thiết kế triển khai

- Giữ Next.js API làm cổng truy cập; UI và Pod không gọi database trực tiếp.
- Thêm lớp repository riêng cho dữ liệu SQL; tách tên Redis/runtime ra khỏi `db()` để tránh gọi nhầm backend.
- Dùng schema ứng dụng riêng (dự kiến `arena`), tài khoản backend giới hạn quyền và TLS. Không mở bảng cho `anon`/trình duyệt. Nếu bảng được đặt trong schema exposed thì phải có RLS và grants phù hợp. Cơ chế đăng nhập hiện tại không tạo JWT Supabase Auth, nên không dùng `auth.uid()` như thể đã có Supabase Auth.
- Giữ Supabase Auth, Storage, Realtime và Edge Functions ngoài phạm vi lần chuyển này. Không đổi mật khẩu của người dùng hoặc bắt đăng ký lại.
- Driver Postgres qua **Supavisor IPv4 pooler**, pool nhỏ, timeout và kết nối lại sau idle. Ưu tiên transaction mode cho cấu hình tương thích cả Render và Vercel, không dùng prepared statements phụ thuộc session. Không dùng direct endpoint IPv6 rồi mặc định Render truy cập được, không cần mua IPv4 add-on.
- Thông tin plugin cho phép quản lý project, không tự cấp kết nối database cho app Render/Vercel. Credential runtime sẽ được cấu hình riêng qua cơ chế secret, không đưa vào chat, Git hoặc biến `NEXT_PUBLIC_*`.
- Giữ index cho username chuẩn hóa, thành viên theo user/team, đăng ký theo round/user, quota theo run/team/task/split và bài nộp theo run/team/task/split/time. Bảng core dùng cột/ràng buộc quan hệ; JSONB chỉ dành cho cấu hình biến đổi hoặc payload legacy được lưu để đối chiếu.
- Các thao tác quan trọng có request receipt/unique ID riêng trong SQL. Không chỉ dựa vào Redis TTL cho chống trùng dài hạn sau migration.
- Không thêm worker/cron tính phí chỉ để đồng bộ. Công việc đồng bộ phải lưu trạng thái bền vững, retry có giới hạn qua request/heartbeat hiện có; không trông cậy một tác vụ trong RAM sẽ tiếp tục sau khi Render Free ngủ.

Các nhóm bảng dự kiến: identity/team; package/asset metadata; round/run/registration/announcement; submission/quota/request receipt; GPU template/credential/workspace history; chat history/usage; audit/outbox. Tên và cấu trúc chi tiết sẽ được chốt khi implement, theo dữ liệu legacy đã kiểm tra.

## 5. Thứ tự thực hiện sau khi được duyệt

1. Tách repository và thêm schema/migration có version, giữ mode Redis hiện tại trong lúc phát triển. QA dùng schema/namespace riêng, không đụng dữ liệu production.
2. Chuyển nhóm user/team/package/round/registration/submission/quota và các giao dịch liên quan. Sau đó chuyển cấu hình/lịch sử GPU/chat, hoàn thiện ranh giới SQL–Redis; chưa cutover nửa vời các nhóm phụ thuộc.
3. Viết công cụ export/import có dry-run, kiểm kê đầy đủ key, giữ ID, hash mật khẩu, credential ciphertext, mốc thời gian, run cũ và thời hạn bản ghi có TTL. Bản ghi không khớp quan hệ được báo để xử lý, không tự bỏ qua; lịch sử của tài khoản/team đã xóa vẫn phải giữ được.
4. Tạo bản sao lưu riêng tư và chạy rehearsal. So sánh số lượng, checksum chuẩn hóa, quan hệ, quota, kết quả xếp hạng và tải lại file cũ. Đo dung lượng SQL thực tế và độ trễ trước khi kết luận phù hợp Free.
5. Cài bản code hỗ trợ backend mới trên mọi deployment có thể ghi production. Vì Vercel vẫn được giữ, phải dùng cùng nguồn dữ liệu với Render khi cutover; không để một host ghi SQL còn host cũ tiếp tục ghi Redis. Nếu Vercel bị quota chặn cập nhật, phải xử lý đường ghi cũ trước khi mở ghi bằng backend mới.
6. Khi không có phiên thi/tác vụ GPU đang hoạt động, dùng khoảng bảo trì ghi ngắn để lấy snapshot/delta cuối, import, đối chiếu và chuyển mode. Thời lượng xác định sau rehearsal, không hứa trước số phút. Bao gồm đăng ký, đổi mật khẩu/team, thao tác admin, nộp bài và callback ghi; không chỉ khóa nút ở UI.
7. Smoke trên Render/tên miền chính và kiểm tra các đường truy cập production còn lại. Giữ Redis cũ để đối chiếu/khôi phục, không FLUSHDB hay xóa hàng loạt sau khi chuyển.

Đề xuất không dùng dual-write toàn bộ ứng dụng trong thời gian dài: với tải nhỏ, một cutover có kiểm soát dễ đối chiếu hơn và giảm nguy cơ hai nguồn dữ liệu lệch nhau.

## 6. Tiêu chí nghiệm thu

- Đăng ký/đăng nhập/đổi mật khẩu, admin, team, lời mời, duyệt vòng giữ đúng hành vi; tài khoản và session hiện có còn hợp lệ theo TTL.
- Hai yêu cầu tạo tài khoản/team/nộp bài/cấp GPU trùng hoặc đồng thời không tạo bản ghi hay cấp phát trùng.
- Quota, idempotency, admin test, invalid submission, điểm/tie-break và bảng xếp hạng khớp trước/sau chuyển, kể cả task 3 và run cũ.
- Mở private, thu hồi quyền, đổi team, reset và phản hồi cũ đến muộn vẫn bị chặn đúng. Không dùng cache Redis cũ để vượt quyền SQL.
- Mất kết nối SQL/Redis tại từng bước không tạo trạng thái thành công giả; retry đúng request, giữ trạng thái chưa xác định để đối soát.
- Chat session giữa hai tab, token budget, fair queue, lease/attempt và Hub ticket dùng một lần tiếp tục đúng. Kiểm thử Runpod mặc định bằng giả lập; không tự tạo GPU tính phí để QA.
- Kết nối từ Render dùng pooler/TLS, phục hồi sau idle, không cạn connection; build, unit/integration, regression hiện có và smoke production qua.
- Có báo cáo import đối chiếu, backup có thể đọc/restore và quy trình rollback thực tế; không coi chỉ đổi biến môi trường là rollback đầy đủ.

## 7. Rollback và giới hạn Free

Trước khi SQL nhận ghi production mới, có thể quay lại bản Redis đã giữ. Sau khi SQL đã nhận dữ liệu mới, cần đóng ghi, đồng bộ phần thay đổi ngược về Redis và đối chiếu trước khi quay lại. Không tự fallback đọc/ghi sang Redis mỗi khi Supabase lỗi vì sẽ tạo hai lịch sử khác nhau.

Theo tài liệu hiện hành, Supabase Free có 500 MB database và 5 GB egress, có thể pause sau một tuần không hoạt động và không bao gồm automatic backups/PITR. Quá giới hạn database có thể chuyển sang read-only. Với quy mô bản ghi đang thấy, Free là lựa chọn hợp lý để bắt đầu, nhưng phải đo size sau import và theo dõi tăng trưởng chat/index; số đo Redis không thay cho phép đo SQL.

Giữ giới hạn lưu chat/job hiện tại, không tự xóa lịch sử nghiệp vụ. Thêm công cụ backup/export và hướng dẫn vận hành; chưa tự tạo lịch automation hoặc dịch vụ backup tính phí. Query cần chọn đúng cột, phân trang lịch sử và tránh tải lại toàn bộ hội thoại/metadata lớn mỗi lần poll để kiểm soát egress.

## 8. Phạm vi cần người dùng duyệt

Cho phép implement phương án **Supabase lưu dữ liệu nghiệp vụ chính + Redis điều phối runtime**, gồm schema/repository, sửa giao dịch và quyền, công cụ migration/backup/rollback, kiểm thử và cấu hình kết nối cần thiết. Giữ phương thức đăng nhập, Upstash Blob/Drive và Vercel hiện có. Cutover chỉ thực hiện sau khi rehearsal/QA đạt và đã xử lý thống nhất nguồn ghi trên các host.

Phạm vi này đã được người dùng duyệt; cutover vẫn phụ thuộc rehearsal/QA và sự thống nhất nguồn ghi trên các host như trên.

## Nguồn đã đối chiếu

- [Supabase pricing / Free limits](https://supabase.com/pricing).
- [Database và disk size, read-only trên Free](https://supabase.com/docs/guides/platform/database-size).
- [Kết nối Postgres và Supavisor](https://supabase.com/docs/guides/database/connecting-to-postgres).
- [IPv4 compatibility](https://supabase.com/docs/guides/platform/ipv4-address).
- [Database backups](https://supabase.com/docs/guides/platform/backups).
- [Changelog CLI v3 ngày 04/11/2026](https://supabase.com/changelog/supabase-cli-v3): kiểm tra `--help` của phiên bản được dùng, phân biệt local/remote; không sao chép lệnh CLI cũ để chạy migration hosted.
- [Thay đổi TLS HTTP API](https://supabase.com/changelog/cbc-tls-ciphers-deprecated): không tác động trực tiếp endpoint Postgres/pooler được đề xuất.
- Source đã đọc: `src/lib/db.ts`, `auth.ts`, `teams.ts`, `admins.ts`, `admin-roster.ts`, `rounds.ts`, `round-control.ts`, `round-quota.ts`, `round-policy-lua.ts`, `arena.ts`, `submission-storage.ts`, `workspaces.ts`, `workspace-teams.ts`, `workspace-templates.ts`, `chat-queue.ts`, `chat-groups.ts`, `hub-store.ts`, `hub-service.ts`, HTTP route và công cụ import hiện tại.
