# OlpAI Arena

Website ôn luyện mô phỏng Olympic AI 2026: Next.js trên Vercel, Upstash Redis và Upstash Blob private.

GPU Workspace: admin cấp Pod riêng/chung cho JupyterLab và DeepSeek 32B Q4; nhóm nhiều Pod Chatbot có hàng đợi công bằng, template dùng chung giữa admin và trần tổng token chỉnh được. Thí sinh chỉ thấy prompt/câu trả lời, không có trạng thái hàng đợi hoặc nút hủy. Xem [hàng đợi và nhóm Chatbot](docs/CHAT_QUEUE.md), [cấu hình GPU Workspace](docs/GPU_WORKSPACE.md).

- Danh sách nhiều vòng luyện. Đăng ký cá nhân, tự duyệt hoặc admin duyệt.
- Đăng nhập, tạo đội, mã mời/lời mời. Đổi thành viên được phép trong lúc thi.
- Hai đề riêng trong mỗi bộ. Tài nguyên chỉ mở cho người đã đăng ký và được duyệt, theo giờ của từng vòng.
- Bắt đầu ngay/hẹn giờ, mở private sớm, mở vô thời hạn, kết thúc và đặt lại vòng.
- CSV UTF-8 tối đa 3 MB. Public/private chấm ngay, chọn điểm cao nhất từng tác vụ, tổng tối đa 200 điểm.
- Tải trực tiếp hoặc mở cùng ZIP trên Drive. Link private chỉ hiển thị khi mở private.
- Bộ đề mới ở danh sách admin trước; admin xác nhận phát hành vòng thì thí sinh mới thấy để đăng ký.

Đọc [hướng dẫn vận hành](docs/ROUND_OPERATIONS.md), [ghi chú cho Astra](docs/ASTRA_CHUAN_HOA.md) và [biên bản kiểm tra](docs/verification.md).

## Cài đặt

Node.js 24. Cấu hình server trong .env (gitignored): UPSTASH*REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN và UPSTASH_BLOB_TOKEN. Bucket phải private; không dùng NEXT_PUBLIC* cho credential.

    npm ci
    npm run seed
    npm run import:contest -- ../statements "Bộ đề 01"
    npm run dev

Seed tạo admin một lần, không ghi đè tài khoản hiện có. Mật khẩu ban đầu nằm trong ACCESS.local.md, không in ra log và không đưa lên Git. Mật khẩu băm scrypt; session 256 bit với cookie HttpOnly/SameSite=Lax/Secure ở production; kiểm tra quyền ở API, kiểm tra Origin và giới hạn tần suất.

Import đưa bộ đề vào danh sách admin, không tự phát hành vòng. Bản nâng cấp từ hệ thống một vòng chạy scripts/migrate-rounds.ts. Namespace mặc định arena:v1; QA/preview phải tách namespace hoặc database.

## Kiểm tra

    npm run typecheck
    npm test
    npm run build

Script qa-rounds-flow.ts kiểm tra qua HTTP và Redis/Blob thật trong namespace QA. CSV kiểm tra riêng cho admin được tạo bởi create-test-submissions.ts và lưu trong .local/test-submissions, không phát cho thí sinh.

Website chấm CSV dự đoán; mã nguồn, trọng số và báo cáo cuối do người coi thi nhận và kiểm tra riêng. Tệp đã tải hoặc liên kết Drive public có thể được chia sẻ ngoài website; người dùng đã chọn cho cả public/private dùng Drive public.

## Nguồn thiết kế và dữ liệu

Luồng đăng ký, duyệt và các trang đề/nộp/BXH tham khảo [Codabench](https://docs.codabench.org/v1.34/Participants/User_Participating-in-a-Competition/) và [cấu hình tự duyệt](https://docs.codabench.org/latest/Organizers/Benchmark_Creation/Competition-Creation-Form/). Bộ đề 01 dùng BBBC038v1 và SQuAD 2.0 từ statements; giấy phép/ghi công gốc được giữ trong nguồn, đang chờ Astra chuẩn hóa bản phát hành.
