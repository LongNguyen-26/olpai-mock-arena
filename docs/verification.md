# Sửa cookie secret khi Hub chạy trên NFS — 30/10/2026

- Log người dùng xác nhận image `5141126f…` tải xong nhưng Hub thoát với `cookie_secret_file can be read or written by anybody`; container lặp lại trước khi có Lab team. Không coi trạng thái này là lỗi trình duyệt hoặc chờ image.
- Giữ khóa gốc trên volume trong thư mục điều khiển root `0700`; tạo bản dùng lúc chạy trên filesystem cục bộ `/run/arena-hub/cookie-secret`, mode `0600`, cùng giá trị. JupyterHub vẫn thực thi kiểm tra quyền gốc. Secret mới tạo bằng mode `0600` ngay lúc tạo tệp, không theo symlink; thư mục sai quyền và khóa lưu bị hỏng gây lỗi rõ, không tự xoay hoặc in khóa.
- [CI 40994198052](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40994198052) đạt typecheck, 82 test TypeScript, build, 28 test Python 3.10 và 9 test Linux. Ca mới khởi động Hub với khóa volume mode `0666`, kiểm tra bản local `0600` giữ giá trị và chặn team đọc cả hai; khóa hỏng không bị tự tạo đè. Các ca UID/NFS/khôi phục/kernel/cộng tác tiếp tục đạt.
- Playwright trên production xác nhận lỗi authorize của Hub đã đóng trả HTML 409 có thông báo, không meta refresh, không tự điều hướng trong bảy giây và không pageerror. Đã xem ảnh `output/playwright/hub-nfs-error-page.png`, đăng xuất phiên QA, xóa auth state và đóng browser. HTTP 409 tạo console resource error đúng dự kiến; không quy thành lỗi JavaScript.
- Theo yêu cầu mới, không bật hay thay image Pod đang tắt. Chỉ chuẩn bị image/template cho Pod mới; chưa nghiệm thu SSO/kernel/WebSocket/CUDA của image cookie mới qua proxy Runpod thật.
- Image publish đã được đối chiếu Docker Hub/CI: `sha256:0ca70c5f5558e586f7ff232e912b58fcaeef7f68601fdeb68f17847fdd89c902`, từ mã runtime `e3acddc7a6c16858980fa9e53afd0a34ffc4ff87`.

# Sửa home team trên Runpod NFS và trang chờ đăng nhập — 30/10/2026

- Người dùng xác nhận `/workspace` dùng NFS4 trong container có UID remapping: root không chown được home (`EPERM`), trong khi `/tmp` chown được. Phép thử tạo tệp trực tiếp bằng UID team thành công, team khác bị chặn, root không đọc được home `0700` (`EACCES`). Đây là lỗi chuẩn bị home sau khi Hub đã chạy; khác lỗi import trước đó.
- Runtime tạo home dưới UID team qua FD staging kín, công bố bằng rename, rồi tạo thư mục/chép tệp/kiểm tra venv bằng UID đó. Kernel và starter nhận đúng FD nguồn đọc; không mở thư mục quản trị cho team hoặc nới quyền home. Chỉ tạo lại home root sở hữu còn trống do lần khởi tạo lỗi; giữ home sai chủ đã có tệp. Log chỉ ghi bước, loại lỗi và errno, không ghi exception string hoặc HTTP body.
- Trang authorize hiển thị lỗi hoặc trạng thái đã dừng thay vì refresh mãi. Chỉ tự kiểm tra trạng thái tạm thời trong tối đa ba phút; không tự dừng workspace khi hết thời gian chờ.
- [CI 40984307571](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40984307571) đạt typecheck, 82 test TypeScript, build, 28 test Python 3.10 và 8 test Linux. Ca mới mô phỏng chặn chown/root đọc home, kiểm tra chủ tệp thật, quyền giữa team, khởi tạo lại home rỗng và giữ home đã có tệp. Các ca Hub/kernel/RTC/khôi phục trước đó tiếp tục đạt. QA Hub và Workspace dùng Redis thật trong namespace riêng, provider giả lập, đã đạt và tự dọn; không thuê Pod.
- Image đã publish ở `sha256:5141126f199fe035a87f172821d14fb28bc7a2a89f9178b36ea265087f45fa95`, mã runtime `5feb69b6e96a2f385094ecc9bff81920f7c7ad2c`. Theo yêu cầu người dùng, dừng kế hoạch sửa/restart Pod hiện tại để người dùng terminate rồi tự cấp Pod mới. Chưa kiểm chứng image này qua SSO/kernel/WebSocket/CUDA trên Runpod thật; không quy kết quả Linux và phép thử filesystem thành nghiệm thu GPU.
- Kiểm thử Python cục bộ trên Windows/Python 3.10 lại treo và đã dừng đúng tiến trình của lần chạy này. Kết quả Python công bố ở trên là 28 ca đã đạt trên CI Linux, không phải lần chạy Windows đó.

# Sửa đường dẫn module khi JupyterHub khởi động — 30/10/2026

- Log Pod thật xác nhận Hub không import được `hub_auth` khi Traitlets đọc `hub_config.py`; container thoát trước khi khởi tạo JupyterLab. Cấu hình hiện thêm đường dẫn module root sở hữu `/opt/arena`, không phụ thuộc thư mục hiện hành hay biến môi trường kế thừa.
- [CI 40979376281](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40979376281) đạt typecheck, 80 test TypeScript, build, 28 test Python 3.10 và 7 test Linux. Test Linux bỏ `PYTHONPATH` và chạy Hub từ thư mục khác trong cả khởi động đầu và phục hồi; vẫn kiểm tra UID, quyền tệp, kernel và cộng tác hai trình duyệt.
- Image sửa đã publish ở `sha256:75434bdfad178c33e0b744582c125c7a33f31d5310ba89c7cf822f50058eaf30`, mã runtime `0c71cfcc68e15721ee4e9e6cd7e3cfcb599597e3`. Thay cho runtime `179b5581…` trong hướng dẫn cấp Pod mới. Kết quả CI không chứng minh CUDA hoặc kết nối qua proxy Runpod.

# Phân biệt tải/giải nén image khi Pod chưa chạy — 30/10/2026

- Thêm chẩn đoán không gây lỗi cho pull/extract từ System Logs; hiển thị trạng thái riêng trên thẻ Pod. Giữ phân loại GPU reset/container error, giới hạn SSE, cache và loại bỏ raw log/credential. Health hoặc telemetry thật xóa tiến trình cũ; chưa chạy container không mở Jupyter/Chatbot.
- Typecheck, 80 test TypeScript và build đạt. Redis QA namespace riêng xác nhận pulling/extracting giữ provisioning, chi phí/reservation và cùng Pod, cache chẩn đoán, lỗi host và phục hồi không cấp lại. Provider/model được giả lập; không thuê GPU để QA.
- Playwright `qa-pod-startup-ui.js` đạt với auth/Redis QA thật: lỗi host, trạng thái chờ chung/pull/extract, hồi phục, khóa truy cập khi chưa sẵn sàng, điều khiển an toàn, desktop/mobile; 0 pageerror, 0 control call. Đã xem ảnh `output/playwright/image-pull-{desktop,mobile}.png`, `image-extract-desktop.png`; đăng xuất/đóng browser và dọn đúng 78 key QA cùng fixture.
- Sự cố Pod thật nằm trước startup JupyterHub: runtime null, agent 404, system log chờ image. Xem [RUNPOD_TROUBLESHOOTING.md](RUNPOD_TROUBLESHOOTING.md). Không diễn đạt sửa web thành khôi phục được mạng/Docker daemon của host Runpod.

# JupyterHub: nhiều team trên một Pod — 30/10/2026

- Thêm chế độ Jupyter-only `team-hub`, workspace theo team, cấp quyền động, SSO ticket dùng một lần và bảng lượt GPU tự quản. Pod vật lý giữ một ledger; Chatbot và chế độ `single` cũ tiếp tục độc lập. Có luồng chuẩn bị/kiểm tra/gắn/gỡ Pod thủ công, xác minh tài khoản Runpod, image digest và runtime identity trước khi cấp manifest.
- Runtime dùng UID/GID thật, home `0700`, venv/kernel riêng và môi trường notebook không có credential điều khiển. Dataset checksum tải một lần, bản chung chỉ đọc, private theo manifest; ghi vào home không đi theo symlink. Dừng team giữ bài làm, thêm team không restart các server đang chạy. Kiểm tra RAM/đĩa trước spawn, không áp quota cứng hoặc cưỡng chế lượt GPU.
- Typecheck, 79 test TypeScript, build web và 28 test Python 3.10 đạt. [CI Linux](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40969488285) đạt 7 test: quyền UID/home/secret, dataset chỉ đọc/private/symlink, thêm team thứ tư giữ ba server cũ, Chromium hai phiên cộng tác/chạy kernel trong venv team và hồi quy file browser/kernel chế độ `single`; thiếu RAM/đĩa/telemetry, hết chỗ và lỗi chuẩn bị một team giữ nguyên các team khác; tạo lại tài khoản Linux/Hub sau dừng cưỡng bức vẫn giữ UID, notebook đã lưu và venv. Hai trình duyệt thấy cùng output, refresh giữ nội dung.
- `qa-hub-flow.ts` dùng Redis thật trong namespace QA riêng với Runpod giả lập: allocation/start đồng thời, grant/revoke, SSO nonce/replay, nhiều team đánh dấu dùng GPU, manual identity/bind/detach và reset cả giữ/đổi run. `qa-workspace-flow.ts` tiếp tục kiểm tra các luồng cũ; không cấp Pod thật.
- Playwright `qa-hub-ui.js` đã kiểm tra API/Redis QA thật, thêm team, bảng lượt, giao diện thí sinh/admin và desktop/mobile; ảnh ở `output/playwright/hub-*.png`. Đã đăng xuất/đóng trình duyệt và dọn fixture/namespace QA. Test Linux dùng SSO cục bộ giả lập và CPU; chưa chứng minh CUDA hay kernel/WebSocket qua proxy Runpod. Hai phần này nghiệm thu trên Pod do người dùng tự cấp.
- Image dependency đầy đủ đã publish ở `sha256:ddbc15474bd5fdb8d63e5d876db0910a638b11ca70bb6ce5c6bf3088b63b40d0`; runtime cuối ở `sha256:179b5581b07e2f4a3b51f27101bdc1bc3f71e6daedbe9f138b21ced172513951`, mã `fc97a34fe490a3a4972be7c1a8e0bd2c3804b8d6`. Xem [JUPYTERHUB.md](JUPYTERHUB.md) để cấp tự động/manual và nghiệm thu Pod đầu tiên. Tag `2026.10.27` cũ được giữ nguyên; template đã lưu và Pod đang dùng không bị tự thay image.

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

## Nhiều tài khoản quản trị — 28/10/2026

- Typecheck, 49 kiểm thử TypeScript và production build đạt. Admin gốc giữ khóa cũ; các tài khoản bổ sung dùng set `admins`.
- `qa-multiple-admins.ts`: namespace QA riêng, dùng chính script provisioning để tạo tài khoản, kiểm tra thử lại không ghi đè mật khẩu; HTTP xác nhận cả hai admin đăng nhập và điều khiển vòng, user thường bị từ chối, admin bổ sung nộp thử không trừ quota/không vào BXH, các admin không bị tính là thí sinh và thu hồi quyền có hiệu lực ngay trên phiên đang đăng nhập.
- Không thay đổi password/session của admin hiện có, cấu hình vòng hoặc owner/credential GPU khi thêm tài khoản. Mật khẩu mới chỉ được lưu trong file local ignored; không in log hoặc đưa vào Git.

## Nộp bài và hiển thị chatbot — 28/10/2026

- Nguyên nhân nộp bài: Blob trả `AccessDenied`; dịch vụ ký upload xác nhận bucket bị read-only vì vượt storage miễn phí. Không đổi gói hay xóa tài nguyên. Khi Blob từ chối ghi, CSV gzip/base64 được lưu vào khóa Redis riêng; API tải vẫn kiểm tra quyền đội/admin và không lộ khóa lưu trữ trong snapshot.
- Typecheck, 51 unit tests và production build đạt. `qa-submission-storage.ts`: HTTP/Redis/Blob thật, namespace QA riêng, cả sáu cặp tác vụ/split chấm đúng; CSV tải lại nguyên vẹn, Unicode filename đúng; bài sai schema giữ lịch sử và không trừ quota; hai POST đồng thời cùng nonce nhận cùng ID và chỉ tính một lượt; yêu cầu trùng/bị từ chối quota không để tệp Redis thừa; đội khác không tải được CSV.
- `qa-workspace-flow.ts`: Redis thật, Runpod/model giả lập, kiểm tra input vượt 1800 và thiếu ngân sách phiên vẫn lưu tin nhắn, dùng hết ngân sách và chặn gọi model tiếp; retry cùng request không tính lại; phiên mới độc lập, số token provider sai không bị coi là vượt giới hạn. Không cấp hay điều khiển GPU thật.
- Playwright Edge desktop/mobile: `qa-chat-sessions.js` giữ tách tab/máy, refresh, `/new`; `qa-chat-rendering.js` kiểm tra KaTeX cho các dấu phân cách, code không bị sửa, clipboard đúng (chuẩn hóa CRLF của Windows khi so sánh), tin nhắn vượt input không trả về composer, khóa phiên qua reload, `/usage` và `/new` vẫn hoạt động. Provider chat giả lập. KaTeX cảnh báo thiếu metric ký tự tiếng Việt nhưng công thức đã được kiểm tra trực quan, không có pageerror.
- `qa-submission-ui.js`: nộp CSV qua UI/API thật trong namespace QA, hiển thị điểm 19,92 và lịch sử trên desktop/mobile, không tràn ngang; logout sau kiểm tra. Ảnh ở `output/playwright/chat-*.png` và `submission-fixed-*.png`, chỉ phục vụ QA.

## Token, template và quyền xem metrics — 29/10/2026

- Typecheck, 56 kiểm thử TypeScript và production build đạt. Không đổi Python runtime hay image. Token có `session` (input/output cộng dồn riêng) và `turn` (giới hạn mỗi lượt); thiếu trường mode giữ cách tính cũ. Footer và log `/limits` cập nhật theo cấu hình mới; cấp Pod mới dùng context theo input + output, Pod cũ không tự restart.
- `qa-workspace-flow.ts`: Redis thật trong namespace riêng, Runpod/model giả lập; kiểm tra hai ngân sách riêng, phiên per-turn vượt tổng cũ vẫn gửi được, lượt quá dài được lưu nhưng không đưa vào prompt kế tiếp, phiên per-session hết input thì khóa; template của hai admin độc lập, tên trùng khi lưu đồng thời chỉ nhận một cấu hình; metrics bị bỏ khỏi DTO state/sync của thí sinh nhưng admin vẫn xem được.
- `qa-workspace-settings-http.ts`: HTTP/Redis thật với fixture QA; kiểm tra admin-only/boolean/running-only cho toggle, xác nhận/revision/tên chuẩn hóa khi lưu template, API chat đọc policy mới của template đang gắn Pod, state và sync không rò telemetry ẩn. Không gọi model/Pod thật.
- `qa-workspace-settings-ui.js`: Playwright Edge desktop 1600px/mobile 390px, đăng nhập và lưu template/metrics qua API thật trong namespace QA; metadata GPU/model giả lập. Đạt các luồng Cấu hình mới, tên trùng, ghi đè cần xác nhận, hủy không lưu, RAM/vCPU thay theo GPU, response cũ không ghi đè GPU mới, refresh giữ bản nháp và tự nhận bản mới khi chưa chỉnh, nạp lại bản đã lưu, footer và `/limits` cập nhật cả hai chế độ ở tab khác, ẩn/hiện metrics theo vai trò. Không tràn ngang hoặc pageerror; logout và dọn cookie sau kiểm tra. QA chat nhiều tab/máy và `/new` tiếp tục đạt.
- Truy vấn metadata Runpod thật đã kiểm chứng `gpuTypes.lowestPrice.minMemory/minVcpu` cho 1 GPU; A40 Secure trả 50 GB/9 vCPU tại thời điểm kiểm tra, A5000 Secure không có offer nên UI không đoán thông số. Đây là dữ liệu offer tại thời điểm đọc, không xác nhận stock hay tài nguyên Pod đã cấp.
- Theo yêu cầu, kho template riêng Admin 1 (`arena_admin`) được khôi phục A40/Secure, RAM tối thiểu 48 GB, 8 vCPU, disk 30 GB, volume 100 GB, tổng legacy 2000/input 1800/output 1024; giữ image digest đang dùng cho Pod mới. Catalogue cũ giữ nguyên A5000 để Admin 2 kế thừa, không đổi Pod. Bản trước thao tác và kết quả nằm trong `.local/primary-template-restore-20261029.json`.



## Hàng đợi, nhóm Pod và template chung — 29/10/2026

- Thay thế chính sách template/token của mục trước: mọi admin dùng cùng catalogue; tổng input + output phiên luôn bị giới hạn ở cả hai mode. Script reset có dry-run, snapshot Redis + file local, ID preset mới và phục hồi; đã kiểm tra trong namespace QA.
- Typecheck và 56 unit test TypeScript đạt; 21 Python CPU test đạt trên Python 3.10/FastAPI 0.115.11/httpx 0.28.1. Production build đạt. ASGI test/build cần chạy ngoài sandbox Windows do sandbox gây treo/EPERM; không có GPU/model thật trong các kiểm tra này.
- Giữ các ca provider/quyền/vòng đời trong `qa-workspace-flow.ts`, cập nhật phần chat sang protocol worker và template chung; bộ này đã đạt với Redis thật/Runpod và model giả lập. `qa-chat-queue.ts` kiểm tra burst 28 prompt, claim/cấp phát đồng thời, chia lượt theo đội, cap liên dịch vụ, lease/uncertain, callback lặp/muộn, drain, reset/private/thu hồi thành viên, outage và phục hồi session cũ. Không cấp GPU tính phí.
- HTTP QA xác minh 202/idempotency/xung đột nội dung, group/worker auth, Origin, cách ly đội và khóa private. Fixture thiếu runtime thật bị giữ ở readiness gate; redirect chỉ hợp lệ khi đủ readiness.
- Playwright Edge desktop/mobile: prompt hiện ngay, không có nhãn tiến trình, animation suy luận hoặc nút hủy; giữ draft khi đang có request, khóa gửi/new, refresh không trùng prompt, outbox retry cùng ID, tách tab và browser. Admin 1/2 thấy và sửa cùng template, trần tổng hiện ở cả hai mode, payload thêm Pod có groupId/allocation UUID. Provider/model giả lập; không tràn ngang hoặc pageerror; đăng xuất sau QA.
- Ảnh QA ở `output/playwright/chat-queue-*.png`, `chat-admin-*.png`. `benchmark-chat-queue.ts` chuẩn bị tải 14/28 request trên nhóm do admin cấp, mặc định dry-run; chưa đo throughput GPU thật.

## Chẩn đoán Pod lỗi host GPU — 29/10/2026

- Log người dùng xác nhận image tải đủ nhưng host lỗi `GPU requires reset` 14 lần khi tạo container. Đối soát thật: Pod đã bị thu hồi, REST 404 và danh sách Runpod rỗng; nhóm còn tồn tại, vòng chưa bắt đầu. Không cấp thêm GPU tính phí để thử.
- Typecheck, 59 unit test và production build đạt. Unit test mới kiểm tra SSE chia chunk, log lỗi có secret chỉ trả mã, log không được cấp quyền/đang tải bình thường không bị xem là lỗi, giới hạn stream và hủy reader.
- `qa-workspace-flow.ts`: Redis thật trong namespace riêng, Runpod/model giả lập; kiểm tra desired RUNNING nhưng chưa có container, lỗi GPU reset, cache log 60 giây, giữ phí và reservation, không tạo trùng, phục hồi cùng Pod. Các kiểm tra vòng đời/quyền/token cũ vẫn đạt. `qa-chat-queue.ts` đạt lại, gồm burst 28 request và phục hồi/lease/cutoff/template.
- Playwright Edge desktop/mobile qua `qa-pod-startup-ui.js`: nhãn lỗi, thao tác dừng/thu hồi còn dùng được cho Pod xác nhận, Admin tự đối soát cả Pod lỗi, nhãn khởi động và trạng thái sau phục hồi. Không tràn ngang hoặc pageerror trong luồng thử; ảnh `output/playwright/pod-startup-{desktop,mobile}.png`. Provider và health được giả lập; chưa xác nhận GPU/inference thật sau sự cố.
- Đối soát bổ sung khi người dùng đã cấp Pod thay thế `4jux2bn1xqpprz` trong cùng nhóm: agent `/health` thật trả 200, CUDA telemetry nhận A40 và queue protocol 1. Vòng vẫn chưa bắt đầu public nên model bị khóa theo policy (`llm=false`); chưa chạy inference. Thẻ Worker nay hiện `modelStage` để phân biệt khóa theo lịch và lỗi khởi động. Không restart hoặc đổi policy của Pod này.

## Thiết kế nhóm GPU và dịch vụ đơn — 29/10/2026

- Khung Chatbot chứa ô mở Chatbot, tổng quan Admin, bộ chọn GPU nằm ngang và toàn bộ thanh Pod thành viên. Mỗi Pod giữ metrics VRAM/utilization/nhiệt độ/uptime/chi phí, lỗi, đối soát và thao tác riêng; bỏ ô Worker Chatbot trùng chức năng. Nút thêm Pod nạp đúng nhóm vào form hiện có, chỉ cấp khi quản trị viên chủ động gửi form.
- Phần điều phối nằm riêng, dùng Pod ID thật, kết nối/heartbeat tới giây, tương thích giao thức/run và thao tác ngừng/tiếp tục giao việc. Nhóm giữ thao tác pause/resume, đối soát các Pod và đóng nhóm khi rỗng.
- Thí sinh dùng nhãn Chatbot, không có thống kê request chờ/chạy, công cụ điều phối hoặc thao tác quản trị. Metrics ẩn được tôn trọng cả ở selector, thanh Pod và tổng chi phí nhóm có thành viên ẩn. Số GPU hiện tại tính cả thành viên nhóm. Pod độc lập chỉ Chatbot/JupyterLab chỉ hiện ô dịch vụ được cấp; Pod hai dịch vụ giữ hai ô.
- Typecheck, 59 unit test và build đạt. Redis QA namespace riêng với provider/model giả lập tiếp tục đạt. Playwright `qa-grouped-workspace-ui.js` kiểm tra 0/1/2 GPU, chọn GPU, pause/resume, drain, thêm Pod chọn sẵn nhóm, owner/admin khác/thí sinh, metrics ẩn, dịch vụ đơn, desktop/tablet/mobile 320–390px; không tràn ngang hoặc pageerror. Kiểm tra lại `qa-pod-startup-ui.js` đạt. Ảnh ở `output/playwright/workspace-group-*.png` và `workspace-operations-*.png`.
- Đây là thay đổi web; không đổi image, quota, policy, restart hay cấp Pod thật để QA. Auth QA được đăng xuất và dữ liệu namespace QA được dọn sau kiểm tra.

## Xóa đội/thí sinh, retry capacity và đội theo vòng — 29/10/2026

- Admin có mục **Đội & thí sinh** dùng chung toàn hệ thống: tìm kiếm, xác nhận xóa, chuyển đội trưởng khi cần và lưu nhật ký xóa không chứa password. Xóa đội gỡ liên kết thành viên, giữ tài khoản; xóa thí sinh gỡ tài khoản/chỉ mục đăng nhập/đăng ký và chặn phiên cũ. Tài khoản admin được bảo vệ ở server và Lua. Giữ bài nộp và Pod đã cấp; UI nêu rõ Pod cần quản lý riêng.
- Allocation bị Runpod từ chối rõ do capacity được đánh dấu, giải phóng reservation theo phép so sánh ID và có nút **Thử cấp lại GPU**. Retry đối soát Pod cũ trước, dùng cùng khóa Pod với sync/control, tạo attempt ID mới có idempotency, giữ snapshot cấu hình và trần USD/giờ cũ. Mất ACK hoặc lỗi host không được tự retry. Hỗ trợ nhận diện thông báo capacity của record cũ; không di trú hoặc đổi snapshot Pod đang dùng.
- Dropdown cấp GPU riêng chỉ lấy đội có ít nhất một thành viên hiện tại được duyệt vào vòng đang chọn, phù hợp schema đăng ký theo thí sinh. Đổi vòng xóa lựa chọn không còn hợp lệ; kết quả fetch cũ bị bỏ qua. Backend kiểm tra lại và Lua kiểm tra quyền đủ điều kiện trước khi reserve/create. Pod chung tất cả đội giữ quy tắc cũ.
- Typecheck, 61 unit test và build đạt. `qa-admin-operations.ts` dùng Redis QA riêng/Runpod giả lập: xóa và gỡ đăng ký, chuyển đội trưởng, chặn hành động stale, giữ submission; retry đồng thời, sync/retry tranh khóa, template đổi sau capacity, callback mất ACK, xác nhận Pod đã tồn tại và bảo vệ admin khác. `qa-workspace-flow.ts` và `qa-chat-queue.ts` tiếp tục đạt.
- Playwright `qa-admin-operations-ui.js`: xóa tài khoản/đội QA thật qua HTTP/Redis, hủy xác nhận không xóa, phiên thí sinh đã xóa nhận 401, Origin sai và thí sinh bị chặn 403, admin bổ sung được phép quản lý, lọc đội giữa hai vòng, giữ retry ID sau network failure, desktop/mobile không tràn ngang hoặc pageerror. Ảnh `output/playwright/admin-roster-*.png`, `admin-approved-teams-*.png`. Lỗi network trong test retry được chủ động giả lập.
- Đã dọn các namespace/fixture và đăng xuất QA; không xóa đội/thí sinh thật hay tạo GPU tính phí để thử. Giữ nguyên thiết kế Chatbot theo yêu cầu hủy phần thu gọn.

## Chatbot xử lý đồng thời — 29/10/2026

- Template có lựa chọn 1/2/4/8 lượt đồng thời mỗi GPU; preset/form Chỉ Chatbot mới mặc định 4, cấu hình dùng chung Jupyter và allocation cũ mặc định 1. Thêm `ARENA_LLM_PARALLEL` khi cấp Pod, giữ context mỗi request và cấp tổng KV context theo số slot. Một tiến trình model dùng continuous batching; readiness đối chiếu số slot và context engine.
- Worker giao thức 2 có slot ID/capacity được server kiểm tra; giao thức 1 tiếp tục một slot. Claim/attempt, token reservation, session/đội/run và callback được bảo vệ khi chạy đồng thời. Đối soát nhiều job dùng một Lua script có giới hạn, giảm lượt HTTP/clock. Stop/terminate đặt drain trước khi đọc tất cả slot.
- Agent lưu journal riêng từng slot, đọc journal cũ ở slot 0, không chạy lại inference sau restart/mất xác nhận. Timeout 600 giây; slot có kết quả engine chưa rõ bị giữ cho tới khi xác nhận idle hoặc tiến trình đã dừng. Một lỗi không tự restart model và làm hỏng các slot khác. Endpoint theo dõi engine chỉ trên localhost 8080.
- Typecheck, 62 unit test, build production và 28 test Python CPU đạt. Build/Python cần chạy ngoài sandbox Windows do hạn chế mkdir/socket của sandbox; không phải yêu cầu truy cập GPU. Test Python giả lập inference chứng minh hai lượt chồng lấp và chặn vượt capacity, quarantine sau timeout, context từng slot, journal độc lập và phục hồi journal cũ.
- `qa-chat-queue.ts`: Redis thật trong namespace riêng, provider/model giả lập; thêm burst 28 request trên hai worker × bốn slot, chặn claim trùng/vượt slot/sai capacity, callback sai slot, uncertain riêng slot 3, drain khi slot 0 đã hoàn tất, tổng capacity tám và tương thích worker cũ. `qa-workspace-flow.ts` tiếp tục đạt; fixture/namespace được dọn sau QA.
- Playwright `qa-chat-concurrency-ui.js`: auth và lưu template QA thật qua HTTP/Redis; mặc định/lựa chọn 1/2/4/8, payload lưu và reload, snapshot allocation đang chạy giữ nguyên, thống kê nhóm tám slot và worker giao thức 2, ẩn lựa chọn ở Jupyter-only. Đã xem ảnh desktop/mobile `output/playwright/chat-concurrency-*.png`; không có pageerror. Thông tin worker/model được giả lập, chưa chứng minh throughput GPU thật.
- Phạm vi chỉ chatbot đồng thời; không thêm API/UI nhận Pod ngoài. Không cấp GPU, restart/thu hồi Pod thật hoặc chạy benchmark model thật trong QA. Phát hành image và web sẽ được ghi bổ sung bằng SHA/digest sau khi CI hoàn tất.

## Cloud All và thứ tự menu Admin — 29/10/2026

- Admin GPU Workspace có Cloud **All**, lưu và nạp lại template qua schema/API, gửi enum `ALL` trong một yêu cầu cấp Pod. Truy vấn tài nguyên không giới hạn `secureCloud`; dự toán và kiểm tra trần USD/giờ dùng giá catalogue hợp lệ cao hơn của Community/Secure. Menu **Quản trị vòng** đứng trước **Đội & thí sinh** khi đang xem vòng.
- Typecheck, 65 unit test và build production đạt. Ba test bổ sung kiểm tra schema/giá All, request tài nguyên và mutation cấp Pod đúng enum, một request. Build chạy ngoài sandbox Windows sau lỗi EPERM khi tạo thư mục prerender.
- `qa-workspace-flow.ts --keep` đạt với Redis trong namespace QA mới, provider/model giả lập. Playwright `qa-cloud-options-ui.js` kiểm tra API tài nguyên với cache QA, lưu template All qua HTTP/Redis và tải lại, chuyển Community/Secure/All, giá dự toán, thứ tự menu, desktop và mobile 390/320px. Không có lỗi console/pageerror/request hay tràn ngang trong luồng thử; đã xem ảnh `output/playwright/cloud-options-{desktop,mobile}.png`.
- Catalogue giá và tự động đối soát được giả lập trên trình duyệt; cache tài nguyên được nạp riêng cho QA. Không cấp/đổi/restart Pod thật để kiểm tra tính năng. Đã đăng xuất và xóa cookie trình duyệt QA; namespace và fixture được dọn sau kiểm tra.

## Lịch, quyền submission/chatbot và luyện sau thi — 29/10/2026

- Tách lịch/giai đoạn khỏi quyền nhận bài, hiển thị submission và chatbot/JupyterLab. Có điều chỉnh lịch đang chạy, private sớm giữ hạn kết thúc mặc định, hai lựa chọn chuyển private áp dụng đúng một lần, cấp lại chatbot có hạn, luyện sau thi cùng run/quota/BXH với một hạn chung. JupyterLab chỉ kiểm soát mở từ web; giữ kernel, tệp và Pod.
- Typecheck, 71 unit test và build production đạt. `qa-round-controls.ts` dùng Redis thật với namespace mới: 72 fixture đối chiếu TypeScript/Lua ở biên thời gian, chuyển private một lần, guard thời gian ngay lúc commit, request trùng, hai admin đồng thời/form cũ, khóa/ẩn khi nộp và quota tích lũy khi luyện tiếp. Các lượt QA tự dọn theo namespace.
- `qa-workspace-flow.ts` dùng Redis thật, Runpod/model giả lập: cấp lại chatbot trong private, job đã prepare bị thu hồi rồi cấp lại không phát phản hồi cũ, ẩn/hiện submission không khóa lại chatbot; manifest luyện tập không còn cutoff private đã qua, chat/Lab dùng được, khóa Lab và kết thúc luyện đúng quyền. Bộ đếm xác nhận các thao tác vòng mới không gọi create/stop/resume/terminate Pod; hồi quy provisioning và dịch vụ chung/riêng tiếp tục đạt.
- Playwright `qa-round-access-ui.js` chạy với HTTP/Redis QA thật và đề giả nội bộ: hai checkbox mặc định, sửa lịch giữ cả giây/millisecond và run/start, private sớm giữ giờ kết thúc, ẩn/hiện private, cấp lại chatbot, quyền admin 403 với thí sinh, ẩn submission trả 409, CSV rỗng ở split mở trả 422 và lưu lịch sử; luyện tiếp giữ run, cả hai split, chuyển private tự động và hết hạn chatbot. Desktop 1600px/mobile 390px không tràn trang/hộp thoại hoặc pageerror, không có HTTP 5xx. Đã xem ảnh `output/playwright/round-access-{private-desktop,timing-mobile,student-mobile}.png`; các ảnh lịch/luyện tập khác cùng tiền tố.
- Không thay image hoặc chạm Pod thật; kiểm tra này chưa đo model/GPU thật và chưa phát hành production. Trình duyệt QA đã đăng xuất/đóng; server local và fixture QA được dọn sau nghiệm thu.

## Luyện trực tiếp sau đặt lại và tùy chọn giữ BXH — 30/10/2026

- **Mở luyện tập tiếp** có trong trạng thái chưa bắt đầu/đã hẹn giờ/đã kết thúc. Chuyển từ lịch hẹn sang luyện tập có thông báo và hủy lịch bắt đầu thi. Đồng hồ/thẻ vòng hiển thị thời điểm bắt đầu luyện tập.
- **Đặt lại / mở lượt mới** dùng hộp thoại có lựa chọn giữ BXH, mặc định bật. Giữ BXH giữ cùng run, bài nộp và quota đã dùng; bỏ giữ tạo run mới, lưu riêng lượt cũ. Reset có run/revision/request ID, lưu snapshot nguyên tử, chặn trùng và form cũ. Hàng đợi chat được fence bằng epoch khi giữ run. Nhãn quyền đã đổi thành **Nhận bài nộp**.
- 74 unit test và build đạt. `qa-round-controls.ts` kiểm tra Redis thật trong namespace QA: giữ/xóa ledger và quota, snapshot lượt cũ, reset đồng thời/trùng request, nhận bài sau luyện trực tiếp và hủy lịch thi. 72 fixture TypeScript/Lua và các luồng trước tiếp tục đạt.
- `qa-workspace-flow.ts` với Runpod/model giả lập xác nhận reset giữ/đổi run rồi mở luyện trực tiếp, manifest/launch Lab gắn đúng run mới, Pod ID được giữ và không gọi create/stop/resume/terminate trong các thao tác này.
- Playwright HTTP/Redis QA thật kiểm tra điểm mẫu trước/sau giữ BXH, bỏ giữ tạo BXH trống, hủy xác nhận không đổi vòng, hai lựa chọn bắt đầu thi/luyện sau reset, luyện từ lịch hẹn và nhãn mới; desktop 1600px/mobile 390px không tràn hoặc pageerror. Đã xem ảnh `output/playwright/round-access-reset-{keep-desktop,clear-mobile}.png`. Các luồng chuyển private, submission, chatbot, expiry trước đó tiếp tục đạt. Auth, server và fixture QA được dọn sau kiểm tra; không sửa vòng hoặc Pod production để QA.
