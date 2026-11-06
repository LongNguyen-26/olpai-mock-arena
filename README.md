# OlpAI Arena

Website ôn luyện mô phỏng Olympic AI 2026: Next.js trên Render, Supabase Postgres cho dữ liệu chính, Upstash Redis cho runtime và Upstash Blob private cho tệp. Địa chỉ chính: https://olpaiarena.cyou. Vercel được giữ nguyên, kể cả tự deploy, để có thể dùng lại sau này.

Xem [triển khai và vận hành Render](docs/RENDER_DEPLOYMENT.md): cấu hình Free, kiểm tra production và nâng compute plan khi cần.

Xem [vận hành Supabase, backup và rollback](docs/SUPABASE_DATABASE.md). Chuyển mode không tự chuyển dữ liệu; production chỉ mở ghi sau import và đối chiếu.

Khách có thể xem vòng luyện, đề đã công bố và BXH. Dữ liệu, nộp bài, đội và Workspace yêu cầu đăng nhập. Xem [quyền truy cập và Supabase Auth / Google / Resend](docs/PUBLIC_ACCESS_AUTH.md) trước khi bật xác thực mới.

Chatbot hỗ trợ [Groq API với key riêng của từng admin](docs/GROQ_CHATBOT.md), chọn model và cấp riêng/chung theo vòng luyện.

Thí sinh sử dụng Trợ lý AI với [lịch sử chung của đội theo vòng luyện](docs/CHAT_HISTORY.md), token còn lại và bộ đếm ký tự. Lịch sử được giữ sau khi vòng kết thúc.

[GPU Workspace tải theo từng phần](docs/WORKSPACE_LOADING.md), có khung chờ và giữ nội dung khi quay lại; danh sách đã thu hồi tải khi mở tab.

GPU Workspace: admin cấp Pod riêng/chung cho JupyterLab và DeepSeek 32B Q4; nhóm nhiều Pod Chatbot có hàng đợi công bằng, template dùng chung giữa admin và trần tổng token chỉnh được. Thí sinh chỉ thấy prompt/câu trả lời, không có trạng thái hàng đợi hoặc nút hủy. Xem [hàng đợi và nhóm Chatbot](docs/CHAT_QUEUE.md), [cấu hình GPU Workspace](docs/GPU_WORKSPACE.md).

Jupyter-only có thêm [JupyterHub theo team](docs/JUPYTERHUB.md): nhiều Lab riêng trên một Pod, cộng tác hai máy, cấp team động, nhận Pod manual và bảng đăng ký GPU tự quản. Pod cũ giữ chế độ một Lab.

- Danh sách nhiều vòng luyện. Đăng ký cá nhân, tự duyệt hoặc admin duyệt.
- Đăng nhập, tạo đội, mã mời/lời mời. Đổi thành viên được phép trong lúc thi.
- Hai đề riêng trong mỗi bộ. Tài nguyên chỉ mở cho người đã đăng ký và được duyệt, theo giờ của từng vòng.
- Bắt đầu ngay/hẹn giờ, sửa lịch khi đang chạy, chuyển private sớm với lựa chọn quyền, mở luyện trực tiếp hoặc sau thi có hạn/vô hạn; đặt lại có lựa chọn giữ BXH. Điều khiển độc lập submission, chatbot và mở JupyterLab từ web.
- CSV UTF-8 tối đa 3 MB. Public/private chấm ngay, chọn điểm cao nhất từng tác vụ, tổng tối đa 200 điểm.
- Tải trực tiếp hoặc mở cùng ZIP trên Drive. Link private chỉ hiển thị khi mở private.
- Bộ đề mới ở danh sách admin trước; admin xác nhận phát hành vòng thì thí sinh mới thấy để đăng ký.

Đọc [hướng dẫn vận hành](docs/ROUND_OPERATIONS.md), [ghi chú cho Astra](docs/ASTRA_CHUAN_HOA.md) và [biên bản kiểm tra](docs/verification.md).

## Cài đặt

Node.js 24. Cấu hình server trong .env (gitignored), theo .env.example. Production dùng ARENA_DATABASE_MODE=postgres và ARENA_DATABASE_URL qua transaction pooler TLS; Redis/Blob vẫn cần thiết. Bucket phải private; không dùng NEXT_PUBLIC_ cho credential. Bản local mới chưa import SQL dùng ARENA_DATABASE_MODE=redis và namespace QA riêng trước khi seed.

    npm ci
    npm run seed
    npm run import:contest -- ../statements "Bộ đề 01"
    npm run dev

Seed tạo admin một lần, không ghi đè tài khoản hiện có. Mật khẩu ban đầu nằm trong ACCESS.local.md, không in ra log và không đưa lên Git. Mật khẩu băm scrypt; session 256 bit với cookie HttpOnly/SameSite=Lax/Secure ở production; kiểm tra quyền ở API, kiểm tra Origin và giới hạn tần suất.

Import đưa bộ đề vào danh sách admin, không tự phát hành vòng. scripts/migrate-rounds.ts và refresh-round-package.ts là công cụ Redis lịch sử, được chặn trong postgres mode; điều khiển vòng qua admin hiện tại. Namespace mặc định arena:v1; QA/preview phải tách namespace hoặc database.

## Kiểm tra

    npm run typecheck
    npm test
    npm run build

Script qa-rounds-flow.ts kiểm tra qua HTTP và Redis/Blob thật trong namespace QA. CSV kiểm tra riêng cho admin được tạo bởi create-test-submissions.ts và lưu trong .local/test-submissions, không phát cho thí sinh.

Website chấm CSV dự đoán; mã nguồn, trọng số và báo cáo cuối do người coi thi nhận và kiểm tra riêng. Tệp đã tải hoặc liên kết Drive public có thể được chia sẻ ngoài website; người dùng đã chọn cho cả public/private dùng Drive public.

## Nguồn thiết kế và dữ liệu

Luồng đăng ký, duyệt và các trang đề/nộp/BXH tham khảo [Codabench](https://docs.codabench.org/v1.34/Participants/User_Participating-in-a-Competition/) và [cấu hình tự duyệt](https://docs.codabench.org/latest/Organizers/Benchmark_Creation/Competition-Creation-Form/). Bộ đề 01 dùng BBBC038v1 và SQuAD 2.0 từ statements; giấy phép/ghi công gốc được giữ trong nguồn, đang chờ Astra chuẩn hóa bản phát hành.
