# GPU Workspace — 27/10/2026

- Chốt theo người dùng: A40 48 GB, DeepSeek 32B Q4_K_M, môi trường luyện tập cho phép Internet/pip; registry `nguyenlong26/olpai-workspace`. Bổ sung nguồn OLP chính thức về 2.000 token chung input/output mỗi session năm 2025, không áp thành luật 2026.
- 22 kiểm tra TypeScript và 7 kiểm tra runtime Python CPU/ASGI/ZIP đạt: quyền, giới hạn token, khóa private và dừng model để trả VRAM. Không quy thành kiểm thử GPU.
- Script `qa-workspace-flow.ts` đạt trên Redis thật trong namespace QA mới, Runpod/Pod HTTP giả lập: mã hóa credential, cấp đồng thời chỉ gọi create một lần, quyền đội, private manifest, token/idempotency, reset run, stop/start/terminate và phục hồi mất xác nhận. Không tạo Pod thật.
- Script `qa-workspace-http.ts` đạt qua bản production build tại localhost:3010 với dữ liệu QA: phiên đăng nhập, 401/403, Origin, DTO không secret, redirect Jupyter, khóa chatbot private.
- Giao diện admin desktop/mobile và chatbot đã được mở và xem ảnh; nút Chatbot tạo tab mới, `/usage` hiển thị ngân sách. Ảnh QA trong `output/playwright`, không chứa Runpod key thật.
- Build image local đã dừng do ổ C hết dung lượng/lỗi I/O; chưa push image từ máy local. Theo yêu cầu chuyển sang workflow GitHub Actions, pin SHA các action, kiểm tra web/Python trước build/push, cần `DOCKERHUB_TOKEN` trong repository secret. Không tự tạo GPU trả phí để nghiệm thu.
- Còn cần xác nhận CI build/push thành công và một lượt chạy A40 thực tế để kết luận CUDA, model, hai kernel và chia sẻ VRAM hoạt động.

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
