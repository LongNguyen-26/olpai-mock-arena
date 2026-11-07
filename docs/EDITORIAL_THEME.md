# Nhận diện xanh đêm — bản đã duyệt 07/11/2026

Người dùng đổi hướng sau mockup và đã duyệt ảnh chụp bản local tăng sắc cam, cho phép áp dụng và deploy lên Render. Bản trắng ngà/serif toàn tiêu đề đã bị loại bỏ. Logo PNG và ba HTML email được bàn giao để người dùng tự cập nhật Google OAuth/Supabase.

## Giữ lại

- SVG monogram A dùng chung cho shell, loading, đăng nhập, onboarding, xác nhận email và trang pháp lý; accessible name cho link logo khi ẩn wordmark ở tablet.
- Sidebar xanh đêm ngả xám: màu nền `#1d2f3d`, gradient nhẹ `#233847` → `#192b38`, active `#334b5d`. Điểm nhấn cam `#ff9b62` ở logo, icon menu đang chọn, nhãn thời gian và họa tiết đăng nhập theo phản hồi mới nhất; bỏ lớp opacity làm mờ họa tiết AI. Tham khảo ảnh người dùng gửi, không áp dụng nút cam hoặc mảng nền rực.
- Source Serif 4 Variable **chỉ dành cho chữ OlpAI Arena**. Font đóng gói cùng website; không tải từ Google lúc sử dụng.
- Nút chính, hero vòng luyện và panel tối trang đăng nhập đồng bộ xanh đêm. Form, trạng thái chức năng và dữ liệu dùng màu gốc.
- Các tinh chỉnh kích thước chạm menu/nút trên điện thoại và input tìm/lọc 16px.

## Khôi phục

- Nền xám lạnh dịu `#eef1f4` (giảm sáng nhẹ so với nền cũ), card và header trắng; bỏ toàn bộ nền trắng ngà. Form đăng nhập trên nền `#f4f6f8`.
- Be Vietnam Pro cho tiêu đề, nội dung, biểu mẫu, bảng; IBM Plex Mono cho code.
- Card vòng luyện về hình dáng, kích thước, ảnh bìa nguyên màu và layout cũ; khung TV1/TV2 về nền xám xanh như trước.
- Bỏ các thay đổi màu diện rộng của theme trước ở Workspace/chat, bảng điểm và trang pháp lý.

Style chọn lọc nằm trong `src/app/editorial-theme.css`; `globals.css` cùng các file CSS gốc giữ nguyên để khôi phục đúng các quy tắc cũ. PNG OAuth xuất từ `src/app/icon.svg`; cấu hình branding Google bên ngoài chưa thay đổi.

## Nghiệm thu bản xem trước

Ảnh và callback kiểm tra bản tăng sắc cam lưu trong `output/playwright/night-blue-accent-*` (ignored). Catalogue dùng anonymous public GET được replay; Workspace/chat dùng fixture, không ghi backend, tạo Pod hoặc gọi model. Đây là ảnh chụp giao diện chạy thật trên localhost, không phải mockup AI.

Kết quả bản sửa: production build và TypeScript qua; 114 kiểm thử đạt. Playwright xác nhận nền mới/font và khung tác vụ gốc/màu ảnh gốc, tìm/lọc, desktop/tablet/mobile và Workspace/chat giả lập; không có browser exception hoặc HTTP lỗi trong các lượt kiểm tra. Ba email giữ nguyên các biến mẫu và liên kết xác thực; kiểm tra preview desktop/mobile bằng dữ liệu minh họa. Trạng thái phát hành thực tế phải đối chiếu SHA và `live` trên Render, rồi kiểm tra tên miền chính.
