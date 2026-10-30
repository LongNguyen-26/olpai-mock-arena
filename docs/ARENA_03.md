# Bộ đề 03

Bộ đề có hai tác vụ, mỗi tác vụ tối đa 100 điểm:

- Dự báo 7 ngày cho 128 chuỗi phụ tải điện: CSV `id,prediction`, MASE theo scale từng chuỗi rồi tính `100/(1+MASE)`.
- Nhận diện đa nhãn 28 cảm xúc: CSV `id,labels`, macro-F1 nhân 100; EM là độ khớp chính xác tập nhãn, dùng khi hòa điểm.

Hai metric có điểm xác định trực tiếp, khai báo trong `directJudgeSpecs`. Mỗi tác vụ chỉ được dùng một trong `judgeSpecs` hoặc `directJudgeSpecs`; schema kiểm tra tên/thứ tự cột và điểm tối đa. Bộ chấm được chọn ở server từ package đã lưu. CSV vẫn qua kiểm tra UTF-8, kích thước, ID, kiểu giá trị và quyền public/private hiện có.

Nguồn và gói local ở `../statements/Arena_03/`. Bản chuẩn hóa ở `web_ready/release_20261030/`; dữ liệu điện UCI và GoEmotions, cùng BERT Tiny nền của Google. Giấy phép và thay đổi dữ liệu nằm trong tài liệu ghi công tải riêng; số lượng cuối và đối chiếu đầy đủ ở `internal/qa/`.

Theo yêu cầu tổ chức, ZIP public trên web không có notebook. Hai baseline được giữ ở local trong `Arena_03_Local_co_baseline.zip` và riêng `Arena_03_Baseline_phat_sau_1_gio.zip`; người quản trị phát thủ công sau 1 giờ. Không upload hai ZIP local này. Agent Workspace giải nén ZIP task-root theo thư mục, không yêu cầu baseline để nạp dữ liệu.

Nạp gói chỉ bổ sung catalogue quản trị. Không tự tạo vòng hoặc sửa binding của vòng cũ. Khi tổ chức thi, admin chọn Bộ đề 03 trong form phát hành, đặt lịch/quota và chủ động phát hai notebook sau 1 giờ. Chưa đo thời gian huấn luyện trên GPU.

Kiểm tra local: `npm run typecheck`, `npm test`, `npm run build`; `scripts/check-arena03-package.ts` đối chiếu bốn CSV baseline bằng chính bộ chấm web. `scripts/qa-arena03-flow.ts setup/check/cleanup` dùng server local cổng 3019 với namespace Redis riêng lưu ở `.local/arena03-qa.json`, không cấp GPU. Server phải nhận namespace từ tệp này trước khi khởi động; bước check đối chiếu danh tính QA trước khi nộp bài. Kết thúc phải chạy cleanup để dọn đúng namespace và các tệp nộp của lần QA.
