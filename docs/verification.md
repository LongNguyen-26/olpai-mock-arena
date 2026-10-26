# Biên bản kiểm tra — 27/10/2026

- Next.js production build và TypeScript: đạt.
- 9 kiểm tra đơn vị: ranh giới thời gian, quyền đọc, ẩn private score/EM/path, chọn bản cuối, chọn public tốt nhất, SQuAD normalization, CSV lỗi/UTF-8 BOM/multiline, RLE vượt biên/chồng lấn, AP tại ngưỡng strict IoU, lỗi merge/split/empty: đạt.
- Đối chiếu CSV baseline public thật với bộ chấm Python: CV chênh lệch 1.4e-14 điểm, QA F1/EM trùng đến giá trị xuất ra. Không huấn luyện mô hình.
- 16 kiểm tra tích hợp qua HTTP, Redis và Blob thật trong namespace `arena:qa:20261027`: đạt. Gồm đăng nhập admin; đăng ký; đề niêm phong; quyền admin; tạo đội/lời mời/giới hạn 3 người; hẹn/hủy/bắt đầu; chặn link private; link tải có hạn; chấm cả hai tác vụ; quota chung; idempotency; thay thành viên trong giờ thi; khóa public/mở private tại mốc 5 giờ; ẩn private/chọn bản cuối; admin xem được điểm; khóa toàn bộ/công bố tại 6 giờ; chặn Origin khác; buổi mới có lịch sử/quota riêng.
- Các mốc 5/6 giờ trong kiểm tra được mô phỏng bằng dịch thời điểm bắt đầu trong namespace QA. Không chờ 6 giờ theo thời gian thực.
- Gói contestant, private input, PDF, attribution và 4 bộ đáp án gzip đã nạp vào bucket private. Không đưa dữ liệu hoặc credential vào Git.
- Luồng nhận bài chấm đồng bộ; chưa benchmark tải đồng thời quy mô lớn. Thiết kế phục vụ buổi luyện nhóm nhỏ.
