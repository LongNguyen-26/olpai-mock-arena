# OlpAI Arena

Website tiếng Việt để luyện mô phỏng Olympic AI: Next.js App Router trên Vercel, Upstash Redis cho dữ liệu ứng dụng và Upstash Blob **private** cho gói đề, test, đáp án và CSV đã nộp. Đây là bộ luyện độc lập, không phải đề hay nền tảng chính thức của BTC.

## Sử dụng

1. Đăng ký tài khoản cá nhân bằng tên đăng nhập và mật khẩu, không cần xác thực email.
2. Tạo đội hoặc tham gia bằng mã/lời mời trong ứng dụng. Tối đa 3 người/đội; không giới hạn số máy đăng nhập. Một người có thể thi trong đội một thành viên.
3. Admin đăng nhập bằng tài khoản duy nhất được tạo bởi script seed, mở **Quản trị viên** để bắt đầu ngay hoặc hẹn giờ Việt Nam (UTC+7).
4. Public mở đề/gói contestant và nhận CSV, trả điểm ngay. Mặc định 300 phút và 20 lượt hợp lệ/tác vụ/đội.
5. Private tự mở sau public, nhận tối đa 5 lượt hợp lệ/tác vụ/đội trong 60 phút. Chỉ phản hồi tính hợp lệ. Điểm private/EM bị loại khỏi phản hồi API cho thí sinh đến khi kết thúc.
6. Chọn bản private cuối cho từng tác vụ trong lịch sử; mặc định chọn bản hợp lệ mới nhất. Hết giờ tự khóa cả nộp bài và chọn bản cuối, công bố bảng private.

Thay đổi thành viên được phép cả trong giờ thi. Mọi thành viên của đội được nộp/chọn bản cuối. Điểm, quota và lịch sử thuộc đội tại thời điểm nộp, không chuyển theo người rời đội. Quyền truy cập lịch sử theo đội hiện tại. Việc tạo/đổi đội có thể được dùng để có quota của đội khác; đây là lựa chọn tự do theo yêu cầu của buổi luyện, không phải cơ chế chống thông đồng của cuộc thi chính thức.

Admin luôn đọc được đề, tài nguyên và điểm. Tài khoản admin không được nộp để xếp hạng. Tạo buổi mới sau khi kết thúc sẽ có ID và quota mới; cấu hình và các bản nộp buổi cũ vẫn lưu trong Redis.

## Dữ liệu và cách chấm

- Tác vụ 1: BBBC038v1, Instance AP, 100 ảnh public/102 ảnh private. RLE theo cột, bắt đầu từ 1, mask không chồng lấn; IoU **lớn hơn** từng ngưỡng 0.50–0.95.
- Tác vụ 2: SQuAD 2.0, token F1 chính và EM phụ, 6.224 câu public/5.649 câu private. Chuỗi dự đoán phải xuất hiện nguyên văn trong context hoặc rỗng.
- Tổng = (điểm tác vụ 1 + điểm tác vụ 2) / 2; tác vụ chưa nộp tính 0. Xếp hạng bằng giá trị đầy đủ, hiển thị 2 chữ số. Bằng tổng thì ưu tiên EM tác vụ 2, rồi thời điểm bản nộp cuối sớm hơn.
- Public dùng điểm tốt nhất từng tác vụ; private dùng bản đã chọn, mặc định bản mới nhất.
- CSV tối đa **3 MB**, chấm ngay trong request. Bài sai schema không trừ quota. Máy chủ xác nhận lượt hợp lệ **sau khi chấm**; nếu lúc đó giai đoạn đã đóng, bài không được nhận. Nộp sớm, không chờ giây cuối.
- Cùng mã yêu cầu gửi lại không tạo thêm lượt. Quota, giai đoạn, đội và lưu kết quả được kiểm tra/ghi nguyên tử bằng Redis Lua; đồng hồ dựa trên Redis TIME, không dựa vào máy thí sinh hoặc cron.

Website chấm **kết quả CSV**, không chạy chương trình thí sinh. Người coi thi nhận mã nguồn, trọng số và báo cáo riêng, kiểm tra yêu cầu tái tạo/offline/thời gian theo statement. Website không thể tự xác minh thí sinh có dùng model, test, chatbot hoặc tài nguyên trái quy định hay không.

## Cài đặt và vận hành

Node.js 24, npm. Sao chép `.env.example` thành `.env` và cấu hình 3 biến server:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
UPSTASH_BLOB_TOKEN
```

Bucket phải private. Không dùng tiền tố `NEXT_PUBLIC_` cho credential. Không commit `.env`, `ACCESS.local.md`, `.local` hoặc dữ liệu organizer. `.env` hiện có được giữ để chạy local; Vercel production có các biến tương ứng được cấu hình riêng.

```sh
npm ci
npm run seed
npm run import:contest -- ../statements
npm run dev
```

`seed` không ghi đè admin/buổi thi đã tồn tại. Mật khẩu admin khởi tạo ngẫu nhiên được ghi duy nhất vào `ACCESS.local.md` (gitignored), không in ra log. Đổi mật khẩu trong Tài khoản sau lần đầu. Không có API cấp quyền admin hoặc đăng ký admin. Mật khẩu băm scrypt; session ngẫu nhiên 256 bit, Redis chỉ lưu SHA-256 của token, cookie HttpOnly/SameSite=Lax/Secure khi production, hạn 7 ngày. Có giới hạn tần suất đăng nhập/đăng ký/nộp và kiểm tra Origin cho các thao tác ghi. Không có email khôi phục mật khẩu; người vận hành cần giữ tài khoản admin và bản sao cấu hình an toàn.

Importer cần Python với NumPy/Pillow. Có thể đặt `ARENA_PYTHON` tới Python thích hợp. Dùng `_runtime` hiện có của bộ statements nếu tương thích. Importer tạo nhãn chấm dạng gzip tại `.local/judges/`, upload vào kho riêng tư, upload gói 360 MB bằng multipart và ghi checksum. Không import khi đã hẹn giờ/bắt đầu. Mỗi lần import tạo phiên bản đường dẫn mới để không ghi đè bộ chấm đang được dùng.

Liên kết tải được cấp sau kiểm tra quyền, có hạn 1 phút để bắt đầu tải. Dữ liệu tải về không thể thu hồi; trong giai đoạn private, gói public vẫn có thể tải, nhưng nộp public bị khóa. Không phát `organizer/` hoặc `raw/`. Quản trị không nên chia sẻ credential Blob, Redis hoặc tệp access cho thí sinh.

Deploy repo lên Vercel với preset Next.js, Node 24 và 3 biến server ở environment production. `vercel.json` đặt region Singapore và timeout API 300 giây. Không cần cron cho chuyển giờ. Dùng database/namespace riêng cho development/preview; **không cấp credential production cho mã preview chưa duyệt**. `ARENA_NAMESPACE` mặc định `arena:v1`.

## Kiểm tra

```sh
npm run typecheck
npm test
npm run build
```

`scripts/check-metrics.ts` đối chiếu bộ chấm TypeScript với CSV baseline hiện có; `scripts/qa-setup.ts` và `scripts/qa-flow.ts` chạy luồng tích hợp trong namespace `arena:qa:*`, không chỉnh buổi thi thật. Đặt namespace này cho cả server QA và script. Tài khoản/mật khẩu cố định trong QA chỉ dùng trong namespace kiểm tra, không dùng ở production. Không công khai server QA hoặc đưa namespace QA lên Vercel.

## Tham khảo thiết kế

Luồng đề/dữ liệu/nộp/lịch sử/bảng điểm tham khảo [Codabench – tham gia cuộc thi](https://docs.codabench.org/v1.34/Participants/User_Participating-in-a-Competition/). Cách tách phản hồi public và private tham khảo [Kaggle – competitions](https://www.kaggle.com/docs/competitions). Lịch 5+1 giờ, quota và metric của website tuân theo **bộ mô phỏng trong statements/**, không tự áp thành luật Olympic AI 2026 chính thức. Nguồn và giấy phép dữ liệu được phát trong tệp ATTRIBUTION của gói.
