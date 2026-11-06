# Đề xuất tách Redis khỏi luồng chính và Groq

Ngày khảo sát: **06/11/2026**, múi giờ Việt Nam. Người dùng đã chốt **phương án B**, làm rõ Runpod giữ Redis như cũ, gồm cả Jupyter-only/Hub; chưa cần port runtime GPU sang SQL. Nội dung dưới là bản phân tích ban đầu; trạng thái triển khai và hướng dẫn hiện hành ở [REDIS_SQL_RUNTIME.md](REDIS_SQL_RUNTIME.md).

## 1. Khuyến nghị

Đích phù hợp với nhu cầu sắp tới: **Supabase Postgres cho nghiệp vụ, session và Groq; Redis chỉ là backend tùy chọn của Runpod**. Có thể tắt nhánh Runpod trên Render, giữ mã và lịch sử để mở lại sau. Không cần viết lại toàn bộ GPU/Hub ngay.

Nếu mục tiêu trước mắt chỉ là giảm hóa đơn và tránh refactor lớn, nên làm đợt tối ưu polling nhỏ trước, tiếp tục Upstash Redis trong thời gian ngắn. Số liệu hiện tại chưa chứng minh cần thay nhà cung cấp để tiết kiệm tiền. Nếu yêu cầu là Render phải hoạt động khi hoàn toàn không có Redis credential, cần hoàn tất cả đợt chuyển session/phần dùng chung và đợt Groq SQL; chỉ thêm feature flag không đủ.

Không đề xuất tạo microservice runtime riêng ngay. Trước hết tách các thao tác nghiệp vụ thành module có backend rõ ràng trong cùng ứng dụng. Chỉ tách process/service khi có nhu cầu chạy worker độc lập hoặc chuyển web về Vercel.

## 2. Bằng chứng hiện trạng

### Cloud và dữ liệu

Đã đọc metadata Render, Supabase, Upstash; đọc dữ liệu tổng hợp bằng SELECT và các lệnh Redis chỉ đọc; không đọc nội dung hội thoại hoặc xuất credential.

| Thành phần | Trạng thái tại thời điểm khảo sát |
|---|---|
| Render | Một web service `olpai-arena`, Free, một instance, Singapore; không có Render Key Value hoặc private runtime service |
| Deployment | `e0ce1c0555ef75ec3bdaae1ce1e0ab3748e37722`, trạng thái `live`; code HEAD khác deployment này chỉ ở `docs/verification.md` |
| Health tên miền chính | `ok=true`, `database=postgres`, migration 1, SHA khớp; Groq runner có poll thành công |
| Supabase | Project `olpai-arena`, Singapore, `ACTIVE_HEALTHY`, Postgres 17; database khoảng **31 MB** |
| Nghiệp vụ SQL | 46 user, 18 team; 245 bài nộp; tài khoản/hash mật khẩu, quyền, vòng/run, quota, template và credential đã chuyển SQL |
| Redis | Upstash PAYG, primary Singapore, active, eviction tắt; khoảng **3.384 key / 10,7 MB** toàn database, gồm cả dữ liệu cũ |
| Chi phí Redis | Snapshot thống kê khoảng 08:47 Việt Nam: **199.786 lệnh / 0,401 USD trong tháng**; budget metadata là **20 USD**, không phải phí cố định 20 USD |
| Workspace | 98 bản ghi, đều `terminated` cả trong Redis và lịch sử SQL; không có Workspace đang chạy theo trạng thái ứng dụng |
| Nhóm chatbot | Một nhóm Groq chưa retire, đang **pause**, parallel 2, RPM cấu hình 20; một nhóm Runpod chưa retire nhưng không có Pod ứng dụng còn hoạt động |
| Lịch sử | SQL có 1.505 chat job: 1.494 completed, 11 failed; 1.254 group session và 103 workspace session |
| Đồng bộ | Redis pending history marker hiện bằng 0; write-freeze hiện không bật |
| Tệp bài nộp | 244 bản ghi trỏ Blob; **1 bản ghi dùng CSV fallback Redis**, dung lượng CSV gốc 113.708 byte |

Số liệu Upstash có độ trễ và gồm cả QA/migration của ngày 05/11, không phải workload người dùng thuần. Metadata/bản ghi Workspace không thay cho đối soát hóa đơn và inventory trực tiếp tại Runpod. Không chạy bài đo tải hoặc kiểm thử inference trong lần này. Health là health process, không chứng minh toàn bộ luồng đăng nhập/chat hoạt động.

Vercel được tài liệu vận hành ngày 05/11 ghi là pause tới 30/11/2026 và còn deployment/Redis cũ. Lần này không xác minh lại trạng thái billing Vercel; khi dùng lại phải kiểm tra thực tế và giữ đúng nguồn SQL.

### Dịch vụ đang dùng gì

| Chức năng | Supabase hiện giữ | Redis hiện giữ | Hướng chuyển phù hợp |
|---|---|---|---|
| Tài khoản, quyền, team | User/hash scrypt, admin, team/member/invite | Cookie session token hash → user ID, TTL 7 ngày | Bảng session SQL; giữ cookie và cách hash mật khẩu hiện có |
| Rate limit | Chưa là nơi thực thi limiter dùng chung | Counter nguyên tử và expiry | Counter theo cửa sổ, UPSERT nguyên tử và `expires_at`; cleanup riêng |
| Vòng thi, điểm, quota nộp | Nguồn ghi chính, idempotency, kết quả | Freeze gate còn được đọc trước mutation/nộp bài và một số chuyển trạng thái | Trong mode postgres dùng gate SQL; giữ kiểm tra lại ở lúc commit |
| Groq credential | Ciphertext, masked key, revision | Owner/configuration lock | Transaction/CAS theo revision, khóa ngắn; gọi API ngoài transaction |
| Nhóm Groq | Snapshot cấu hình trong runtime_history | Tạo/sửa nhóm, reservation phạm vi, active indexes | Cấu hình SQL làm nguồn chính; reservation ràng buộc duy nhất/CAS trong SQL |
| Groq chat | Lịch sử bền vững và context có thể khôi phục | Queue công bằng, pending, session đang dùng, token reservation, job, slot, lease, attempt | Chat session/job/quota SQL có state machine tương đương |
| Groq executor | SQL dùng để tìm nhóm | Executor lease, RPM counter, cooldown 429, provider error, kết quả tạm trước finalize | Lease/counter/result SQL; vẫn cần process thực thi gọi Groq |
| Runpod | Template, credential mã hóa, lịch sử Workspace/chat | Provision reservation/lock, trạng thái agent/worker, drain/slot, chat queue, cache giá | Giữ backend Redis tùy chọn trước; trì hoãn port toàn bộ GPU |
| Hub/Jupyter | Lịch sử và cấu hình nghiệp vụ liên quan | Ticket một lần TTL 60 giây, report, GPU turn, notebook state/revision | Giữ trong nhánh Runpod; khi port SQL cần consume ticket nguyên tử |
| Lịch sử chat | Hội thoại và job đã lưu | Đọc SQL hiện vẫn gọi replay marker Redis; live context quay về Redis | Tách đọc SQL trực tiếp khỏi đồng bộ runtime tùy chọn |
| Tệp | SQL lưu metadata/path | Một CSV fallback còn nằm Redis | Chuyển file này sang object storage, đối chiếu hash và quyền download |

File chính vẫn nằm ở **Upstash Blob/Drive**, chưa dùng Supabase Storage. Bỏ Redis và bỏ toàn bộ Upstash là hai phạm vi khác nhau. Nếu muốn cả file chỉ ở Supabase thì phải có thêm migration Storage, kiểm tra tổng kích thước bộ đề/dataset, URL, quyền tải và egress. Không đưa dataset/CSV lớn vào bảng Postgres để thay object storage.

### Các phụ thuộc dễ bỏ sót trong mã

- `src/lib/db.ts`: `db()` luôn là `Redis.fromEnv()`. `ARENA_DATABASE_MODE=postgres` chỉ đổi nơi lưu nghiệp vụ, không vô hiệu hóa Redis.
- `src/lib/auth.ts`: mọi session đăng nhập và limiter vẫn gọi Redis.
- `src/lib/write-control.ts`, `arena.ts`, `sql-rounds.ts`: ngay cả luồng SQL còn đọc freeze key Redis.
- `src/lib/runtime-authority.ts`: khóa SQL theo namespace, xuất projection quyền sang Redis, chạy Lua, đánh dấu rồi ghi bù lịch sử SQL. Không thể thay `db()` bằng PostgreSQL mà giữ nguyên Lua.
- `src/lib/gpu-repository.ts`, `chat-history.ts`: đọc lịch sử SQL vẫn kéo theo `syncRuntimeHistory()` và Redis. Cần tách đường đọc và đường đồng bộ.
- `src/lib/chat-queue.ts`: Groq dùng chung state machine/queue với Runpod, có kiểm tra quyền, run/chatEpoch, tính công bằng và ngân sách; đây là phần refactor lớn nhất.
- `src/lib/groq-runner.ts`: quét mỗi **5 giây**, heartbeat job **10 giây**, lease executor 180 giây; job lease trong queue 45 giây. Selector chỉ lọc provider/retired, chưa lọc paused; `pumpGroqGroup()` đọc summary trước kiểm tra giờ mở chatbot.
- `src/components/workspace-chat.tsx`: poll trạng thái 2 giây khi active/10 giây khi idle, đồng thời poll lịch sử 10 giây. Tăng số tab có thể tăng tải đáng kể dù ít inference.
- `src/instrumentation.ts`: runner khởi động khi `RENDER=true` hoặc bật cờ runner; một timer Node đang chạy không phải giải pháp worker bền vững cho mọi nền tảng.
- `src/lib/submission-storage.ts`: khi Blob trả lỗi phù hợp, CSV được gzip/base64 vào Redis. Không được xóa DB Redis trước khi xử lý file fallback đã có.

## 3. Nếu chuyển Redis sang Postgres thì thay đổi gì?

### Lợi ích

- Core/Groq không còn ngừng hoạt động vì Redis thiếu credential, lỗi kết nối hoặc chạm budget. Một nguồn dữ liệu để backup/đối soát cho các phần đã chuyển.
- Quyền, queue, session chat và ngân sách có thể cập nhật bằng transaction SQL; bỏ được projection SQL → Lua → replay SQL ở nhánh Groq.
- Job/result không còn phụ thuộc key runtime để phục hồi sau restart. Có thể khôi phục job chưa gửi provider và hoàn tất lại result đã lưu mà không gọi model lần nữa.
- Chạy được trên Render và giữ khả năng đưa web về Vercel. Backend dữ liệu và nơi chạy executor là hai quyết định riêng.

### Chi phí và giới hạn

- PostgreSQL tiếp nhận toàn bộ session lookup, limiter, queue claim và heartbeat; tăng I/O, WAL, row churn, dung lượng/index và công việc vacuum. Free có hạn mức thực tế, không phải runtime miễn phí vô hạn.
- Mã hiện giới hạn pool 3 connection/process và nhiều write dùng một advisory transaction lock chung namespace. Nếu thêm tất cả heartbeat/rate counter vào đường khóa này, chat có thể tranh chấp với nộp bài/quản trị. Cần khóa theo row/job/session/group phù hợp, giữ thứ tự khóa nhất quán với policy/reset.
- Không giữ transaction trong suốt cuộc gọi Groq tối đa 120 giây. Quy trình là transaction claim/reserve → commit → gọi provider → transaction persist/finalize.
- SQL không tự xóa row theo TTL như Redis. Mọi đọc phải kiểm tra expiry; cleanup theo batch chỉ thu hồi chỗ. Không dựa vào cleanup chạy đúng giờ để quyết định quyền/session còn hạn.
- `FOR UPDATE SKIP LOCKED` giúp nhiều worker claim không chờ cùng row, nhưng tự nó không tạo công bằng theo đội, không giới hạn parallel theo credential, không đảm bảo budget. Phải giữ các quy tắc này một cách tường minh.
- Queue bền vững không bảo đảm Groq inference chạy đúng một lần. Nếu process chết sau khi provider đã nhận request nhưng trước khi lưu result, vẫn là `uncertain`; không tự gọi lại hoặc hoàn ngân sách chỉ vì lease hết hạn. Chỉ retry tự động khi biết chưa gửi hoặc provider từ chối rõ ràng.
- Supabase Free hiện công bố 500 MB database, 1 GB file storage, 5 GB egress và có pause sau một tuần không hoạt động. Database 31 MB còn nhỏ nhưng không chứng minh đủ CPU/IO ở giờ đông. Pro từ 25 USD/tháng có thể đắt hơn giữ Redis PAYG nhỏ.
- Render Free dừng web sau 15 phút không có inbound traffic. SQL queue vẫn còn nhưng runner cùng process không tiếp tục chạy khi web ngủ; background timer không giải quyết điều này. Đổi Redis sang SQL không chữa cold start hoặc bảo đảm worker 24/7.

Không cần đổi sang Supabase Auth để bỏ Redis. Giữ scrypt và cookie opaque token, lưu hash token/expiry/revocation vào bảng SQL là phạm vi nhỏ hơn. Chuyển nhà cung cấp Auth nên là một quyết định khác.

## 4. So sánh các phương án

Ước lượng ngày công bên dưới dành cho một kỹ sư, bao gồm tích hợp và QA cơ bản, dựa trên khảo sát tĩnh; chưa phải cam kết tiến độ. Các phương án thay thế nhau, không cộng tất cả con số. Không bao gồm thay UI lớn hoặc thay toàn bộ storage file.

| Phương án | Khối lượng dự kiến | Chi phí/vận hành | Đánh giá cho nhu cầu hiện tại |
|---|---|---|---|
| A. Giữ SQL + Upstash, giảm polling | Nhỏ, khoảng 0,5–2 ngày | Giữ PAYG, giảm thao tác thừa | Tối ưu trước mắt nếu chưa bắt buộc bỏ Redis |
| B. SQL cho core + Groq, Redis tùy chọn cho Runpod | Vừa/lớn, khoảng 4–8 ngày | Có thể không dùng Redis khi Runpod tắt; cần đo SQL tải mới | **Đích được khuyến nghị** |
| C. SQL toàn bộ, kể cả Runpod/Hub | Lớn, khoảng 8–15+ ngày | Ít backend hơn nhưng phải port nhiều giao thức và tình huống GPU | Chưa đáng làm khi ít dùng Runpod |
| D. Giữ logic Redis, chuyển Render Key Value trả phí | Vừa, khoảng 1–3 ngày cộng rehearsal dữ liệu | Từ khoảng 10 USD/tháng; managed Valkey, private network | Hợp khi cần Redis latency/chi phí dự đoán được, không giúp bỏ Redis |
| E. Private service tự host Valkey | Vừa, khoảng 2–4 ngày ban đầu, thêm vận hành lâu dài | Compute trả phí + disk/backup; tự lo persistence, restore, update | Chưa đáng với dung lượng/chi phí hiện tại |
| F. Cloudflare Durable Objects/Queues | Lớn, khoảng 5–10+ ngày tùy phạm vi | Thêm Workers, request/duration/storage và đồng bộ với SQL | Có giá trị khi chủ động chuyển kiến trúc sang Cloudflare |

### A. Tối ưu nhỏ, vẫn dùng Redis

1. Giảm quét nhóm đã pause, đã đóng vòng hoặc không có queued/running/uncertain work; phải giữ lượt reconcile cho job còn dang dở và không đánh dấu result replay mất đường xử lý.
2. Wake runner khi enqueue, dùng backoff khi idle; vẫn có safety poll để phục hồi sau process restart. Wake bằng memory chỉ là tối ưu, job SQL/Redis bền vững mới là nguồn sự thật.
3. Dừng/giảm polling tab ẩn; lịch sử tải khi mở, khi hoàn tất turn hoặc refresh, thay vì mọi tab luôn gọi 10 giây.
4. Đo lệnh/turn, lệnh/giờ idle, API latency, SQL lock/pool wait trước/sau; không cam kết phần trăm tiết kiệm khi chưa đo.

Một lệnh mỗi 5 giây liên tục tương đương 518.400 lệnh/30 ngày, khoảng **1,04 USD** theo giá 0,20 USD/100.000 lệnh. Một tick hiện có nhiều lệnh, nên polling là nơi đáng đo. Đây là phép tính minh họa, không phải dự báo hóa đơn của hệ thống.

PAYG hiện khoảng 0,40 USD MTD; budget 20 USD là trần và chạm trần có thể bị rate limit. Không nên suy chi phí cả tháng từ ngày migration. Nếu sau tối ưu đạt khoảng 5 triệu lệnh/tháng, riêng phí lệnh gần 10 USD; lúc đó so lại Upstash fixed với Render managed Valkey, gồm bandwidth, region, dung lượng và công refactor. Không đổi billing trong lần khảo sát.

### D/E. Render managed Valkey và private Valkey tự host

Managed Render Key Value hiện chạy Valkey 8. Nó giữ được cách điều phối Lua/Redis, nhưng ứng dụng dùng **Upstash REST SDK**, còn Valkey dùng giao thức Redis TCP. Không thể chỉ đổi REST URL thành `redis://...`. Cần adapter/client tương ứng, chuẩn hóa JSON serialization, kiểu kết quả Lua, TTL/KEEPTTL, pipeline/multi và lỗi/retry.

Render Free web **có thể gửi** request private network; không bắt buộc nâng web chỉ để kết nối private Key Value/private service. Tài nguyên phải cùng workspace/region. Free web không nhận private traffic và vẫn có idle sleep. Runpod bên ngoài hoặc Vercel không truy cập được internal hostname; nếu chúng chỉ gọi web API thì không cần kết nối Valkey trực tiếp.

Với queue/reservation phải dùng `noeviction` và persistence phù hợp. Free Key Value mất toàn bộ dữ liệu khi restart/nâng gói nên không phù hợp làm nguồn duy nhất của live queue/token budget. Paid Journal + Snapshot ghi journal mỗi giây, vẫn có thể mất khoảng một giây writes; SQL history chưa biến mọi trạng thái Redis thành bản sao có thể phục hồi an toàn.

Private Valkey tự host dùng một private service trả phí; nếu cần bền vững phải có disk cho data/AOF/RDB. Compute cỡ nhỏ tham khảo khoảng 7 USD/tháng, disk khoảng 0,25 USD/GB-tháng, chưa gồm backup và công quản trị. Cần xác nhận báo giá trước khi provision. Mức tiết kiệm danh nghĩa so với managed 10 USD chưa bù trách nhiệm cấu hình, giới hạn bộ nhớ, backup/restore và cập nhật. Nếu chọn Redis-compatible trên Render, ưu tiên managed trước.

### F. Cloudflare

| Sản phẩm | Vai trò có thể dùng | Nhận xét |
|---|---|---|
| Workers KV | Config/cache ít ghi | Eventually consistent, có thể chậm hiển thị cập nhật 60 giây hoặc hơn; không phù hợp lock, consume ticket, token reservation hoặc quota nguyên tử |
| Durable Objects | Coordinator theo nhóm/credential, slot, counter, WebSocket | Storage transactional/strongly consistent; phù hợp về chức năng nhưng phải port state machine sang Worker và giải quyết ranh giới quyền/reset với SQL |
| Queues | Chuyển job tới consumer, retry/DLQ | At-least-once; vẫn cần idempotency, fairness, token budget và `uncertain` riêng. Queue không thay session/lock/state machine |
| D1 | Database SQLite qua Cloudflare | Không phải adapter trực tiếp cho `pg`/SQL đang có. Thêm nơi lưu mutable state khi Supabase đã chạy ổn làm tăng công đồng bộ |
| R2 | File đề/dataset/submission | Hợp nếu ưu tiên storage/egress; không thay queue hoặc session. Đây là nhánh migration file riêng |

Durable Objects SQLite hiện có trên Workers Free, nhưng có giới hạn request/duration/storage; gọi Groq chờ lâu có thể ảnh hưởng duration. Vì vậy không kết luận cần trả phí ngay, cũng không kết luận Cloudflare sẽ rẻ hơn khi chưa có mô hình tải. R2 công bố free egress, vẫn tính storage/operations ngoài quota.

## 5. Phạm vi triển khai đề xuất sau khi chốt

### Đợt nhỏ nếu chưa cần tắt Redis ngay

Làm A, ghi baseline đo tải và tạo ranh giới module runtime theo thao tác nghiệp vụ. Chưa chuyển provider/database hoặc viết lại GPU. Nếu không có yêu cầu vận hành độc lập Redis và hóa đơn vẫn thấp, có thể dừng an toàn ở đây và giữ B trong backlog.

### Đợt core SQL

- Session SQL và limiter SQL, giữ cookie/hash/7 ngày như hiện tại; session cũ có thể yêu cầu đăng nhập lại tại cutover hoặc có migration có giới hạn thời gian.
- Freeze/maintenance trong mode postgres chỉ dùng SQL; gỡ mọi read Redis ở đường nộp bài và chuyển phase SQL sau khi giữ đủ gate.
- Đọc lịch sử/config SQL không chạy replay Redis trong luồng read chung. Replay chỉ là trách nhiệm nhánh runtime đã bật.
- Chuyển CSV fallback hiện có sang object storage, verify checksum trước đổi pointer; chọn rõ cách xử lý lỗi upload mới. Có thể dùng Supabase Storage, giữ Blob hoặc dùng một fallback file nhỏ có giới hạn, nhưng không tự làm mất độ bền khi bỏ fallback Redis.
- Tạo feature gates server cho Runpod, Jupyter/Hub và worker callbacks, đồng thời UI thể hiện trạng thái phù hợp. Các cờ này **chưa tồn tại đầy đủ**, không phải hướng dẫn đổi env ngay.

### Đợt Groq SQL

- SQL là nơi ghi chính của chat group, session, message/history, job, result, token reservation, slot lease và limiter/cooldown theo credential/model.
- Tách thao tác enqueue/claim/prepare/heartbeat/complete/reconcile khỏi Lua dùng chung; triển khai SQL trực tiếp thay vì mô phỏng Redis GET/SET/EVAL trên bảng JSON.
- Claim và reserve trong transaction ngắn, kiểm tra run/chatEpoch/deadline/quyền; giữ fairness giữa các audience và cách tính ngân sách hiện tại.
- Lưu result trước finalize; finalize idempotent theo request/attempt; không tự resend job đã gửi nhưng chưa xác nhận.
- Runner cùng Node web trên Render ở giai đoạn đầu, wake khi enqueue + poll phục hồi/backoff. Nếu cần chạy ngay cả khi không có browser/inbound traffic, dùng web compute luôn hoạt động hoặc worker riêng; đây là lựa chọn compute độc lập với Redis.
- Giữ backend Redis chỉ cho Runpod/Hub; khi cờ Runpod tắt, không có đường core/Groq nào được tạo Redis client hoặc truy cập endpoint Redis.

### Việc trì hoãn

Port toàn bộ provisioning/Hub/notebook GPU turn sang SQL; xóa mode Redis nghiệp vụ lịch sử; tách worker thành service; Supabase Auth; Realtime/WebSocket; chuyển toàn bộ Blob/Drive; Cloudflare coordinator. Chỉ làm khi có nhu cầu và số liệu.

## 6. Điều kiện nghiệm thu và cutover

1. Khởi động bản Render-mode với **không có** hai env Redis. Login/logout, quyền, team, vòng, nộp CSV/download, admin và Groq phải hoạt động. Chặn Redis network trong QA và chứng minh không có request tới Redis; không chỉ dựa vào việc app build được.
2. Hai tab/hai máy vẫn có chat session riêng, refresh giữ session, chat mới không nhận response cũ; giữ quyền lịch sử theo team/run.
3. Gửi trùng request đồng thời không tạo hai job/khấu trừ hai lần; tranh chấp session budget, RPM/cooldown và số slot không vượt hạn mức. Round reset/private hoặc đổi quyền trong lúc job chạy phải chặn callback/commit cũ theo cùng chính sách hiện tại.
4. Mô phỏng restart trước gửi, sau gửi, sau persist result và trước finalize; đo replay/uncertain. Callback lặp và attempt cũ không thay được kết quả mới.
5. Đo đồng thời chat + nộp bài: API p95, thời gian xếp hàng, SQL lock/pool wait, throughput, database growth và idle traffic. Dùng provider giả lập trước; không tạo Pod tính phí để QA.
6. Khi bật lại Runpod, QA nhánh Redis riêng: provisioning lock/reservation, Hub ticket một lần, worker lease/heartbeat/drain, run reset và callback đến muộn. Core/Groq tiếp tục chạy nếu nhánh Runpod Redis lỗi, trừ các thao tác phụ thuộc Runpod được báo lỗi có chủ đích.
7. Cutover khi không có queued/running/uncertain job chưa đối soát và không có tác vụ GPU phải hoàn tất; backup, replay hết pending history, migrate session/file cần thiết, kiểm tra checksum, rồi đổi runtime backend một lần cho đúng nhóm/provider. Không chạy hai backend nhận ghi cùng một queue và không fallback tự động khi SQL lỗi.
8. Nếu SQL runtime đã nhận ghi, rollback phải di chuyển trạng thái mới và kiểm tra lại; không đổi flag về Redis cũ là xong. Chưa xóa database Redis hoặc legacy key cho tới khi xác minh file/history/backups và không còn host cũ nhận ghi.

Khi đưa web về Vercel, tiếp tục dùng SQL được. Phải chọn executor có vòng đời phù hợp: giữ worker trên Render hoặc dùng cơ chế thực thi bền vững khác. Bật Redis không tự làm timer Node hiện tại chạy bền vững trên Vercel. Không để Render và Vercel dùng hai nguồn session/queue khác nhau cho cùng namespace.

## 7. Nguồn đối chiếu

Nguồn nội bộ: code ở các file đã liệt kê; `docs/SUPABASE_DATABASE.md`, `docs/RENDER_DEPLOYMENT.md`; metadata connector và health production ngày 06/11/2026. Các số lượng/cost là snapshot khảo sát, không ghi đè thành quota hoặc cam kết tải.

- [Supabase pricing](https://supabase.com/pricing): Free/Pro, database/file/egress và pause.
- [Supabase Queues](https://supabase.com/docs/guides/queues), [quickstart](https://supabase.com/docs/guides/queues/quickstart): pgmq, visibility window và pull-based consumer. `pgmq`/`pg_cron` chưa bật trong project ở snapshot này; không giả định có sẵn. Có thể dùng pgmq thay phần vận chuyển job, nhưng vẫn cần logic nghiệp vụ phía trên; với phạm vi nhỏ ưu tiên đánh giá bảng SQL chuyên dụng để hạn chế hai nguồn job state.
- [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html): row locking/SKIP LOCKED cho consumer queue.
- [Upstash Redis pricing](https://upstash.com/pricing/redis): PAYG, fixed, budget/rate limit; giá minh họa 0,20 USD/100.000 lệnh, storage dưới 1 GB hiện miễn phí theo trang pricing.
- [Render Key Value](https://render.com/docs/key-value), [Free](https://render.com/docs/free), [private network](https://render.com/docs/private-network): Valkey, TCP/internal URL, persistence/noeviction, idle sleep và quyền gửi private traffic của Free web.
- [Render pricing](https://render.com/pricing), [compute plans](https://render.com/docs/compute-plans), [tham khảo chi phí compute](https://render.com/articles/production-rails-hosting-guide), [persistent disks](https://render.com/docs/disks): managed Key Value/compute/disk. Giá là tham khảo lúc khảo sát, cần xác nhận trước mua.
- [Cloudflare KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [Durable Objects](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Queues delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
