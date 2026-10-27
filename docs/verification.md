# Sửa lỗi cấp GPU HTTP 400 — 27/10/2026

- Nguyên nhân: payload gửi CUDA 13.1/13.2 ngoài enum REST v1 Runpod. Giới hạn lại 12.8/12.9/13.0 theo [schema chính thức](https://docs.runpod.io/api-reference/pods/POST/pods), thêm hồi quy cho payload và thông báo validation chỉ dùng tên trường an toàn.
- 23 kiểm tra TypeScript và build production đạt. Credential admin đã lưu trả HTTP 200 khi list Pod; đối soát yêu cầu BKDN.AVENGERS không có Pod tương ứng. Không in key hay tạo Pod kiểm tra tính phí.

# GPU Workspace — 27/10/2026

- Chốt theo người dùng: A40 48 GB, DeepSeek 32B Q4_K_M, môi trường luyện tập cho phép Internet/pip; registry `nguyenlong26/olpai-workspace`. Bổ sung nguồn OLP chính thức về 2.000 token chung input/output mỗi session năm 2025, không áp thành luật 2026.
- 22 kiểm tra TypeScript và 7 kiểm tra runtime Python CPU/ASGI/ZIP đạt: quyền, giới hạn token, khóa private và dừng model để trả VRAM. Không quy thành kiểm thử GPU.
- Script `qa-workspace-flow.ts` đạt trên Redis thật trong namespace QA mới, Runpod/Pod HTTP giả lập: mã hóa credential, cấp đồng thời chỉ gọi create một lần, quyền đội, private manifest, token/idempotency, reset run, stop/start/terminate và phục hồi mất xác nhận. Không tạo Pod thật.
- Script `qa-workspace-http.ts` đạt qua bản production build tại localhost:3010 với dữ liệu QA: phiên đăng nhập, 401/403, Origin, DTO không secret, redirect Jupyter, khóa chatbot private.
- Giao diện admin desktop/mobile và chatbot đã được mở và xem ảnh; nút Chatbot tạo tab mới, `/usage` hiển thị ngân sách. Ảnh QA trong `output/playwright`, không chứa Runpod key thật.
- Build image local đã dừng do ổ C hết dung lượng/lỗi I/O; chưa push image từ máy local. Theo yêu cầu chuyển sang workflow GitHub Actions, pin SHA các action, kiểm tra web/Python trước build/push, cần `DOCKERHUB_TOKEN` trong repository secret. Không tự tạo GPU trả phí để nghiệm thu.
- [CI build/push thành công](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40476925267), commit `4efd5d143422c8c16f6b2b9145ed0d23255b8ac0`. Image public Linux/amd64: `nguyenlong26/olpai-workspace@sha256:22f21a6b87f728d87f9dedd68028985b7a10be0b451a843f52be751682bea817`; đã ghim digest trong cấu hình production.
- Đã cấu hình ba biến GPU Workspace trên Vercel production, khóa mã hóa dưới dạng Secret theo xác nhận của người dùng; bản sao local nằm ngoài Git. Script `smoke-gpu-production.ts` kiểm tra API sau phát hành mà không cấp Pod hay đổi vòng thi.
- Còn cần một lượt chạy A40 thực tế để kết luận CUDA, model, hai kernel và chia sẻ VRAM hoạt động; chưa tạo Pod tính phí.

# Kiểm tra gói chuẩn hóa và luồng nộp bài — 27/10/2026

- 13 kiểm tra đơn vị đạt: thời gian, phân quyền, schema CSV/RLE, metric, điểm cao nhất và loại bài lỗi/admin khỏi BXH.
- 12 nhóm kiểm tra HTTP tích hợp đạt trên Redis/Blob thật trong namespace QA riêng: tài khoản, đội, đăng ký/duyệt, khóa đề/dữ liệu, quota/idempotency, public/private, vòng vô thời hạn và reset độc lập.
- Bài CSV lỗi trả 422 kèm ID lịch sử, không tăng quota; lỗi hạ tầng không được ghi thành bài CSV lỗi. Bài nộp thử admin được nhận trước/sau giờ thi, không cần đội, không tính quota hoặc BXH. API đội từ chối admin.
- Kiểm tra giao diện qua trình duyệt: vào vòng giữ nguyên khung trang; sidebar không có đội cho admin; spinner khi chấm; kết quả thành công/lỗi; chuyển mục rồi quay lại sẽ có form mới.
- Đã tải 8 đối tượng của `arena-01-standardized-20261027-79ef062c077b` sau khi xác minh kích thước và SHA-256 với upload-plan. Dữ liệu và tài liệu lấy nguyên từ `statements/Arena_01/web_ready`; không chạy lại training.
- Bốn CSV baseline từ handoff được nộp qua API chấm thật và khớp báo cáo chuẩn hóa với sai số dưới 1e-9: CV public 43.21789632788748, private 39.95419176131378; QA public 48.90975121788441, private 50.59815643719256. Các giá trị là kết quả CSV kiểm tra bàn giao, không phải điểm thi của đội.
- File gold chỉ được dùng trong QA tách biệt. Không đưa nhãn chấm hoặc CSV QA lên Drive hay Git.
- Người dùng yêu cầu xóa 3 bài thử cũ và chuyển vòng hiện tại sang gói mới, chờ admin bắt đầu. Script kiểm tra chính xác run ID và object prefix trước khi xóa; giữ tài khoản, đội và đăng ký.
- Chưa benchmark tải đồng thời lớn; ứng dụng phục vụ luyện nhóm nhỏ.

# Kiểm tra bản nhiều vòng luyện — 27/10/2026

- TypeScript và Next.js production build: đạt.
- 12 kiểm tra đơn vị: mốc thời gian, vòng vô thời hạn, mở private sớm, tổng điểm, điểm cao nhất, schema CSV/RLE, metric và tách/sạch nội dung từng tác vụ: đạt.
- 11 nhóm kiểm tra tích hợp qua HTTP với Redis và Blob thật trong namespace arena:qa:rounds2: đạt. Gồm đăng ký cá nhân, catalogue không lộ tài nguyên, tự duyệt, duyệt thủ công, thu hồi quyền, đề khóa trước giờ, chấm CSV thật, quota/idempotency chung theo đội, mở private sớm và BXH trực tiếp, tổng 200 điểm, vòng vô thời hạn và đặt lại vòng không làm lẫn điểm/quota vòng khác.
- CV và QA grader giữ nguyên định nghĩa metric đã đối chiếu Python ở bản đầu; không train mô hình.
- CSV public thử: CV baseline 43.21789632788748, điểm thấp 0, điểm cao 100; QA baseline 48.759952210945315, điểm thấp 5.912596401028278, điểm cao 100. File cao được tạo từ gold chỉ để kiểm tra ứng dụng, không phải model score.
- ZIP gốc không được thay đổi. Train/validation, JSON và baseline đóng gói chờ Astra theo quyết định người dùng.
- Drive: tải public 359652506 byte và private 9500906 byte; xác nhận chia sẻ Viewer / bất kỳ ai có liên kết. URL chỉ lưu trong metadata Redis, không commit vào Git.
- Giao diện đăng nhập, danh sách vòng và quản trị được xem trong trình duyệt. Không benchmark tải đồng thời lớn; ứng dụng phục vụ luyện nhóm nhỏ.
# Sửa cấp GPU thực tế — 27/10/2026

- Chuyển quản lý Pod sang GraphQL với cùng mutation như Python SDK GraphQL; truyền cấu hình qua variables, chỉ lấy id/name/status/rate. Giữ catalog giá REST v2.
- Kiểm tra trực tiếp: A40 Community trả `SUPPLY_CONSTRAINT` trong HTTP 200 và không tạo Pod. Đã cấp đúng một A40 Secure cho BKDN.AVENGERS, Pod `0fb95yqf1t0bka`, Runpod xác nhận RUNNING và $0,59/h. Chưa kết luận dịch vụ trong container/model sẵn sàng chỉ từ desiredStatus.
- Dùng CUDA tối thiểu 12.8 thay enum REST v1 cố định; catalog thực tế báo host CUDA 13.2. Mặc định và template đã lưu dùng Secure.
- Sửa ước tính chi phí khi chưa nhận Pod ID về $0, kể cả dữ liệu cũ; không tự gửi lại khi mất xác nhận. Giữ thông báo hết tài nguyên khi đối soát yêu cầu bị từ chối.
- Typecheck và 26 unit tests đạt. Script tích hợp Redis thật, Runpod giả lập đạt: cấp đồng thời, mất xác nhận, SUPPLY_CONSTRAINT, hủy yêu cầu lỗi, stop/start/terminate, quyền đội, private và token.

# Kiểm chứng Jupyter, reset vòng và DeepSeek — 27/10/2026

- Sửa Workspace tự gắn run ID mới của cùng vòng; giữ Pod và tách chat/token theo run. Nút dùng cùng điều kiện pha, đăng ký và service readiness như backend. Tab chat tự đồng bộ khi model sẵn sàng, không phụ thuộc dashboard đang mở.
- Model worker theo dõi policy liên tục: khởi động lại khi public mở, trả VRAM khi private/đóng; chặn phản hồi của run cũ sau reset.
- 27 unit tests, 9 Python tests, typecheck và Redis QA đạt. CI Ubuntu/Python 3.10 xác nhận web production build và runtime tests.
- [CI image cuối thành công](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40508452681). Digest runtime: `sha256:f3ce6656c68b37f3d574c6b0f7f95243a4eef4de75363c22f2a07e020fd2bba5`. Cập nhật Pod cũ `0fb95yqf1t0bka`, kiểm tra không có kernel trước mỗi lần restart; volume `/workspace` 100 GB giữ nguyên, cache GGUF 19.851.335.840 byte còn đủ.
- Kiểm chứng trên Pod thật: `/api/status` không token trả 200; `/api/contents` và `/api/kernels` không token trả 403; status có token giữ schema Jupyter chuẩn. Mở Notebook theo quyền thí sinh sau reset trả 200.
- DeepSeek thực sự lên A40 (~19,2 GiB VRAM); token-count và generate qua agent trả 8 token. Không chạy notebook training hay chấm dữ liệu thi.
- Chrome/Playwright xác nhận uptime tăng từng giây và Chatbot bị vô hiệu khi model chưa sẵn sàng. Uptime lấy từ telemetry, không tính từ thời điểm gửi yêu cầu cấp phát.
- Kiểm tra browser tìm thêm lỗi Host nội bộ của proxy làm Jupyter chặn WebSocket. Cấu hình `allow_origin` đúng domain của từng Pod và `trust_xheaders`; không bật wildcard hoặc tắt xác thực. Browser đã render đầy đủ Lab và chạy `1 + 1` qua kernel WebSocket, trả `2`; kernel QA được xóa sau kiểm tra.

# Pod chung và tách dịch vụ — 27/10/2026

- 29 unit tests, 13 Python tests và typecheck đạt. Redis QA dùng namespace riêng/Runpod giả lập kiểm tra: một private Pod cũ cùng hai shared Pods, cấp đồng thời không trùng, đội tạo sau, chặn người chưa có đội, legacy reservation, tách lịch sử/token theo đội và chặn route dịch vụ không bật.
- [Image tách dịch vụ build/push thành công](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40514595000). Mặc định/template cho Pod mới ghim digest `sha256:b6ca1acfecc2ed190280679ca2d29f82fd541bc1224d4d399abf976086f6ebcb`. Production kiểm chứng Pod hiện có vẫn cùng ID/image cũ, scope team/services both; không restart hoặc tạo GPU mới trong kiểm thử tính năng.
- Chrome/Playwright desktop 1440 và mobile 390 px: chọn scope all/Jupyter-only, giữ lựa chọn dataset, xác minh payload teamId null và đúng round/services; nhóm shared/private cùng hiện; LLM-only không có link Notebook và ngược lại. Mobile không tràn ngang. POST cấp Pod trong UI QA được chặn và trả dữ liệu ví dụ, không gửi tới Runpod.
- API production chặn cấu hình scope team thiếu teamId bằng 400 trước cấp phát. Default image mới, DTO legacy và trường nội bộ/secret đã được kiểm tra. Hướng dẫn lỗi Runpod được lưu riêng và liên kết trong AGENTS.md.

# Chat riêng theo máy/tab — 28/10/2026

- Mở Chatbot lần đầu tạo UUID và lưu vào `sessionStorage` theo Pod; refresh giữ UUID. “Đoạn chat mới”/`/new` đổi UUID, xóa lịch sử hiển thị và bản nháp; ID mặc định cũ bằng Pod ID được thay bằng UUID.
- Ba unit tests mới đạt; typecheck và bộ test hiện có đạt. Playwright kiểm tra hai tab cùng browser, browser context riêng, refresh, chat mới, `/new`, lịch sử và tab còn lại trên localhost và production. API chat giả lập, không gọi model hay tạo Pod. Script tái sử dụng: `scripts/qa-chat-sessions.js`.
- Production SHA `2d85f21d59634c23d1ee8925e76bfe95fa53012e`, deployment `dpl_EQbanhaPxHRMAQDWjeYXJj4Qey3M` đã `READY`; smoke login/API/config thật đạt. Không đổi Docker image, Redis schema hoặc Pod đang chạy. Hướng dẫn build/deploy/QA và các lưu ý vận hành đã bổ sung trong `AGENTS.md`.

## GPU layout và gói task-root — 28/10/2026

- Typecheck, 49 kiểm thử TypeScript, production build và 15 kiểm thử runtime Python CPU đều qua.
- `qa-workspace-flow.ts`: Redis namespace riêng, Runpod/agent giả lập; kiểm tra không nạp dataset trả assets rỗng, vẫn giữ quyền/lịch và chuyển metadata task-root. Không tạo GPU thật.
- `qa-gpu-layout-ui.js`: Edge desktop 1600px/mobile 390px, login QA thật, provider giả lập. Kiểm tra telemetry Pod cũ có nhãn/đơn vị, trạng thái thu gọn mở được, thông báo cạnh Làm mới, bỏ tổng chi phí rời và payload không nạp dataset; không tràn ngang, không có pageerror.
- Bản chuẩn hóa dưới `statements/Arena_01|02/web_ready/release_20261028`: 5 notebook đã chạy public/private trên CPU, không training; CSV đủ ID/schema, dữ liệu/bộ chấm/weights đối chiếu nguồn, PDF được render kiểm tra. Nguồn cũ giữ nguyên, bản mới chỉ nạp catalogue quản trị, không tự phát hành vòng.
- `check-standardized-baselines.ts`: cả 10 CSV được bộ chấm web hiện tại chấp nhận, mỗi tệp dưới 3 MB. Đây là kiểm tra pipeline/schema và nhãn chấm, không khẳng định chất lượng mô hình hoặc benchmark GPU.
- CI runtime [40574925727](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40574925727) build/push thành công; digest `sha256:4510a9e0bfbb96ca83873df7535d61367b594d841387557b561df4ab5a5a94cf` đã ghim trên env production và template tương lai. Danh tính, image và vòng gắn trên record Pod hiện tại không đổi.

## Quản lý hiển thị và bố cục vòng — 28/10/2026

- Typecheck, 49 kiểm thử TypeScript và production build đạt. Runtime Python/image không thay đổi.
- `qa-round-visibility.ts`: HTTP/Redis thật trong namespace QA riêng, kiểm tra admin-only, boolean validation, danh sách và link tài nguyên ẩn trả 404, đăng ký bị chặn, bản nộp đang xử lý bị chặn trước khi trừ quota, hiện lại giữ đăng ký; vòng đã xóa trả 404 với cả admin.
- `qa-workspace-flow.ts`: Runpod giả lập, kiểm tra Workspace vòng ẩn không hiện cho thí sinh, agent inactive, lịch sử Pod của vòng đã xóa vẫn đọc được cho admin. Không tạo hoặc điều khiển GPU thật.
- `qa-round-management-ui.js`: desktop 1600px/mobile 390px; tên vòng trên header, link quay về rõ hơn, ô datetime và nút Hẹn giờ thẳng hàng, timestamp UTC+7 đúng, ẩn/hiện/bắt đầu nhanh trên thẻ, nhãn vòng đang xem. Bố cục quản trị gồm điều khiển ngang, cấu hình, thông báo, kết quả và danh sách đăng ký; kiểm tra không tràn ngang.
- Xóa khỏi web đúng hai vòng dùng package cũ: `a544c419-8b06-4e1f-ac6e-e56444075003` (Bộ đề 01 cũ) và `eb708a8f-5cbd-4c9a-bf27-b7e062786b78` (Bộ đề 02 cũ), theo yêu cầu người dùng. Script vận hành xác minh package binding, không còn Pod đang cấp, dùng CAS cho cả hai vòng; không đổi vòng dùng package chuẩn hóa hoặc xóa source package, đăng ký/kết quả/Pod.

