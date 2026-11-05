# Vận hành trên Render

Quyết định ngày 05/11/2026: Render phục vụ chính, dùng Free trước và nâng compute plan khi cần. Giữ nguyên Vercel và Git integration của Vercel. Không cần xóa dấu vết hay viết lại ứng dụng theo riêng Render.

## Dịch vụ hiện có

- Workspace: `My Workspace` (`tea-d6fb6q9drdic739rrnf0`).
- Web service: `olpai-arena` (`srv-dbi7v2dg1s2s73e8m740`), Node, Free, Singapore, một instance.
- Repo: `LongNguyen-26/olpai-mock-arena`, nhánh `main`. Cờ tự deploy đang bật, nhưng cần kiểm tra việc nhận Git webhook (xem bên dưới).
- Tên miền chính: `https://olpaiarena.cyou`; `www` chuyển về tên miền gốc.
- Địa chỉ Render: `https://olpai-arena.onrender.com`.
- Dashboard: https://dashboard.render.com/web/srv-dbi7v2dg1s2s73e8m740.

Đã kiểm tra HTTPS trực tiếp: tên miền chính và onrender trả trang từ Render; www redirect về tên miền chính. Không cần thay DNS đang hoạt động.

## Kết quả kiểm tra ngày 05/11/2026

- Commit ứng dụng: `e8d167d88d2ace61597492c5d32f68c58e030e4c`.
- Deploy `dep-dbm22ld9fdbs73bjvpc0`: `live`, build thành công trên Render với Node 24.13.0; server bind `0.0.0.0:10000` và sẵn sàng.
- TypeScript qua; toàn bộ 95 unit test qua khi chạy tuần tự; render.yaml qua JSON Schema chính thức. Chưa dùng Render CLI để validate theo tài khoản.
- QA Workspace qua với Runpod giả lập, Redis/Blob trong namespace QA riêng và tự dọn. Không cấp GPU thật.
- Smoke sau deploy qua trên **cả hai** `olpaiarena.cyou` và `olpai-arena.onrender.com`: `/api/health`, login, cookie Secure/HttpOnly, API yêu cầu đăng nhập, catalogue/đề của 6 vòng và Workspace state. Đọc giá GPU bằng Runpod credential đã lưu thành công, xác minh credential này giải mã được trên Render.
- 98 bản ghi Workspace lịch sử, **0 bản ghi còn hoạt động** tại lúc kiểm tra. Không có cấu hình manual đang chờ gắn thuộc admin được kiểm tra; chưa kiểm tra Jupyter/kernel/inference thật trong lần này. Không tạo hoặc restart Pod để QA hosting.
- Không thấy sự kiện server failed/restarted/suspended/hardware failure trong khoảng theo dõi ngắn ngay sau deploy. Đây không phải cam kết không có lỗi trong tương lai hoặc kiểm tra tải đồng thời.
- Mẫu metric trước deploy: RAM khoảng 180–215 MB trên giới hạn 512 MB, phần lớn CPU thấp khi ít traffic. Cần quan sát lại khi có nhiều người dùng.
- Build local biên dịch được nhưng worker TypeScript bị Windows từ chối cấp phát bộ nhớ; TypeScript chạy riêng qua và build đầy đủ trên Render qua. Không tắt type checking để vượt qua lỗi.
- Công cụ UI dừng vì không xác định được URL Chrome; xác minh production qua HTTP/API và log Render, chưa kiểm tra browser/kernel thật.

Các cập nhật tài liệu sau commit ứng dụng không yêu cầu build lại; dùng `[skip render]` cho commit chỉ có tài liệu khi thích hợp.

## Kiến trúc và cấu hình

Next.js chạy bằng Node web service, không dùng static export. API trình duyệt gọi đường dẫn tương đối trên host đang mở. Từ cutover 05/11/2026, Supabase Postgres lưu dữ liệu chính; Upstash Redis giữ session, hàng đợi, lease và runtime/cache; file nằm trên Upstash Blob/Drive. GPU/Jupyter/LLM vẫn chạy ở Runpod. Xem [database, backup và rollback](SUPABASE_DATABASE.md). Không có Vercel SDK, Vercel Blob, Edge Config hoặc Vercel Cron trong luồng ứng dụng hiện tại.

Không cần chuyển dữ liệu, seed lại, tạo database Render hoặc gắn persistent disk cho web. Không lưu dữ liệu nghiệp vụ lên filesystem của Free service.

Build command:

```sh
npm ci --include=dev && npm run build
```

Start command chuẩn:

```sh
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "$PORT"
```

Lệnh start đang có trong Dashboard còn gán `GPU_WORKSPACE_PUBLIC_URL="$RENDER_EXTERNAL_URL"` trước khi chạy Next. Đây là cấu hình hợp lệ: callback đi thẳng tới Render qua onrender.com. Nó ưu tiên hơn giá trị cùng tên trong Environment. Nếu muốn callback dùng tên miền chính, bỏ phép gán này và đặt `GPU_WORKSPACE_PUBLIC_URL=https://olpaiarena.cyou`; không bắt buộc thay để web hoạt động.

Node được giới hạn ở major 24 trong package.json. `NODE_VERSION` trong Dashboard ưu tiên cao hơn package.json; giữ giá trị 24 nếu biến này được đặt.

`render.yaml` là cấu hình tham chiếu cho một dịch vụ Free duy nhất. Hiện dịch vụ được quản lý trực tiếp trong Dashboard; commit file này không tự đổi cấu hình cloud. Không tạo Blueprint mới một cách máy móc vì có thể tạo dịch vụ trùng. Nếu chuyển sang quản lý Blueprint sau này, kiểm tra việc tiếp nhận dịch vụ hiện có trước khi Apply.

## Biến môi trường

Giữ nguyên các giá trị production sau trên Render:

| Biến | Yêu cầu |
| --- | --- |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Cùng Redis production hiện có |
| `UPSTASH_BLOB_TOKEN` | Cùng bucket private hiện có |
| `ARENA_NAMESPACE` | `arena:v1`, hoặc bỏ trống để dùng mặc định hiện tại |
| `ARENA_DATABASE_MODE` | `postgres` sau cutover đã đối chiếu; không tự đổi về Redis để fallback |
| `ARENA_DATABASE_URL` | Server-only, role `arena_backend`, Supabase transaction pooler 6543/TLS |
| `GPU_WORKSPACE_ENCRYPTION_KEY` | **Đúng khóa production cũ**, không sinh lại |
| `GPU_WORKSPACE_PUBLIC_URL` | Origin HTTPS của host đang phục vụ; có thể dùng onrender.com hoặc tên miền chính |
| `GPU_WORKSPACE_LOGIN_ORIGINS` | Các alias HTTPS dùng để mở Hub; gồm tên miền chính, www và onrender nếu sử dụng |
| `RUNPOD_WORKSPACE_IMAGE`, `RUNPOD_HUB_IMAGE` | Giữ digest image đã kiểm tra và template tương ứng |

Code mới có thể dùng `RENDER_EXTERNAL_URL` khi chưa đặt callback origin. Cấu hình tường minh vẫn ưu tiên, nên có thể chạy trên Vercel hoặc host khác. Không có tự fallback HTTP về Vercel khi Render lỗi.

Runpod API key của admin được mã hóa trong Supabase sau migration, không cần đưa key đó vào biến public của web. Không đổi encryption key để chữa lỗi deploy. Khóa có độ dài đúng mới chỉ là kiểm tra cấu hình; đọc giá GPU thành công bằng credential đã lưu mới kiểm tra được giải mã credential đó và gọi provider.

Pod đã tạo giữ `ARENA_CONTROL_URL` và alias login trong môi trường riêng. Đổi Environment của web không tự cập nhật Pod cũ. Nếu có Pod đang dùng URL cũ và cần đổi, kiểm tra riêng rồi lên lịch thao tác; không tự restart/thu hồi Pod hoặc rebuild image chỉ vì đổi hosting web.

## Kiểm tra và phát hành

```sh
npm run typecheck
npm test
npm run build
npx tsx scripts/smoke-render-migration.ts --require-health
npx tsx scripts/smoke-render-migration.ts --base=https://olpai-arena.onrender.com --require-health
```

Nếu máy local thiếu bộ nhớ khi test chạy nhiều tiến trình esbuild cùng lúc, chạy đầy đủ suite tuần tự:

```sh
npx tsx --test --test-concurrency=1 tests/*.test.ts
```

Smoke tạo session admin tạm, đọc catalogue/đề/API Workspace, kiểm tra cookie và logout. Nếu đã lưu Runpod credential, smoke chỉ đọc giá GPU; không cấp Pod, chạy model, nộp bài, seed hay thay đổi vòng thi. Cấu hình manual đang chờ gắn được kiểm tra khi thuộc admin đang dùng. Smoke không khẳng định đã kiểm tra môi trường thực tế bên trong Pod.

Các script production mặc định dùng `https://olpaiarena.cyou`. Chọn host khác bằng `--base=https://...` hoặc `ARENA_BASE_URL`; có thể chọn Vercel khi cần kiểm tra lại. Script Arena 04 chỉ kiểm tra host được chọn, không tự chạy trên cả hai provider.

Push commit đã kiểm tra lên `main`, theo dõi xem Render đã tạo deploy chưa, đối chiếu **full SHA**, trạng thái `live`, rồi chạy smoke. Không trigger thêm deploy khi auto deploy đang chạy. Vercel vẫn có thể tự deploy cùng commit theo cấu hình cũ.

Trong lần kiểm tra ngày 05/11, push commit ứng dụng không tạo event/deploy mới dù `autoDeploy=yes`. Vì vậy đã chạy một lần Manual Deploy sau khi xác nhận không có deploy nào đang chạy. Theo [tài liệu Render](https://render.com/docs/deploys), tự deploy cần liên kết Git provider; dịch vụ lấy source từ public repo URL phải deploy thủ công. Cần kiểm tra và liên kết đúng GitHub repo trong Dashboard nếu muốn Render tự nhận các push tiếp theo. Không suy ra webhook đã hoạt động chỉ từ cờ autoDeploy. Công cụ trình duyệt của phiên này dừng vì không xác định được URL Chrome, nên chưa chỉnh liên kết Git provider qua UI.

`/api/health` trả trạng thái process, không gọi Redis/Blob mỗi lần Render probe. Có thể đặt Health Check Path này trong Dashboard sau khi route được deploy. TCP health check đang có vẫn hợp lệ. Kiểm tra kết nối dữ liệu nằm trong smoke, không coi process health là bằng chứng toàn bộ nghiệp vụ hoạt động.

## Chọn Free và khi nào nâng gói

Free phù hợp giai đoạn ít người dùng nếu chấp nhận thời gian khởi động sau khi ngủ. Theo [Render Free](https://render.com/docs/free), service ngủ sau 15 phút không nhận traffic và có thể mất khoảng một phút để hoạt động lại; có 750 giờ Free chung cho workspace mỗi tháng. Bandwidth và build pipeline cũng có quota. Không dùng ping giả để giữ service thức.

Callback từ Pod và request từ trình duyệt đều là traffic thật. Khi có Pod hoạt động, các heartbeat có thể khiến web tiếp tục chạy và tiêu thụ giờ Free. Khi tổ chức một phiên luyện cần truy cập ngay, nên nâng sang gói trả phí trước phiên để tránh cold start, kể cả chỉ có ít người.

Theo [compute plans](https://render.com/docs/compute-plans), Free có 0,1 CPU/512 MB RAM; Starter hiện có ID `0.5c-512mb`, 0,5 CPU/512 MB. Starter tăng CPU và bỏ các giới hạn riêng của Free, nhưng **không tăng RAM**. Theo dõi CPU, RSS, lỗi OOM, độ trễ và HTTP 5xx; nếu thiếu RAM thì cần gói có nhiều RAM hơn. Giữ upload lớn đi trực tiếp qua Drive/Blob thay vì proxy qua web.

Đổi compute plan trên đúng service; không cần tạo lại web hoặc di chuyển Redis/Blob. `render.yaml` đang ghi `plan: free`: nếu sau này dịch vụ được quản lý bởi Blueprint thì cập nhật file khi nâng gói để tránh lần sync tiếp theo đưa về Free. Không nâng gói tính phí tự động trong lần chuẩn bị này.

Nguồn cấu hình: [Next.js trên Render](https://render.com/docs/deploy-nextjs-app), [Web services/PORT](https://render.com/docs/web-services), [biến môi trường](https://render.com/docs/configure-environment-variables), [Blueprint spec](https://render.com/docs/blueprint-spec), [health checks](https://render.com/docs/health-checks).
