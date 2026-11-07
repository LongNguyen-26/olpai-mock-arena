# Mẫu email Supabase / Resend

Ba tệp HTML là mã nguồn để dán nguyên vào **Body → Source** ở Supabase Authentication → Emails. Có thể chỉnh câu chữ/màu/spacing trực tiếp trong HTML.

| Template trong Supabase | Subject gợi ý | Body Source |
| --- | --- | --- |
| Confirm sign up | Xác nhận email — OlpAI Arena | `confirm-signup.html` |
| Reset password | Đặt lại mật khẩu — OlpAI Arena | `reset-password.html` |

Giữ nguyên biến `{{ .ConfirmationURL }}` trong các liên kết. Supabase tạo liên kết xác thực; Resend gửi cả email xác nhận và email khôi phục qua cùng Custom SMTP đang cấu hình. Không cần thêm Resend API key vào frontend hoặc thay Google client.

Luồng khôi phục: **Quên mật khẩu → nhập email → nhận thư Reset password → mở link trên cùng trình duyệt → chọn mật khẩu mới → đăng nhập lại**. Các phiên Arena cũ bị thu hồi sau khi lưu mật khẩu mới. Dành cho tài khoản Supabase, gồm tài khoản Google muốn thêm mật khẩu; tài khoản scrypt lịch sử không được reset qua email chưa xác minh.

Trong trang SMTP, giữ sender thuộc domain đã xác minh. Tắt click tracking cho email Auth để dịch vụ gửi thư không sửa liên kết. Bản mẫu không có tài nguyên từ bên ngoài hoặc JavaScript. Preview trình duyệt không thay kiểm tra hiển thị thực tế trong mọi ứng dụng email.

Sau khi dán và Save, kiểm tra riêng một email Confirm sign up và một email Reset password. Bản ZIP bàn giao giữ placeholder của Supabase, không chứa email người dùng, mật khẩu hoặc mã xác thực thật.

## Change email address

Subject: Xác nhận thay đổi email — OlpAI Arena. Dán change-email.html vào Authentication → Emails → Change email address → Body → Source.

Giữ nguyên {{ .SiteURL }}, {{ .TokenHash }}, {{ .Email }}, {{ .NewEmail }}. Mẫu mới dùng liên kết /auth/email-change với TokenHash để xác nhận trên một trang có nút bấm, tránh trình quét email tự tiêu thụ liên kết; không đổi mẫu này sang ConfirmationURL nếu muốn giữ cơ chế đó. Site URL cần là https://olpaiarena.cyou (không thêm dấu / ở cuối). Hai mẫu đăng ký/khôi phục cũ vẫn giữ ConfirmationURL.

Bật Confirm email và Secure email change trong Authentication → Providers/Sign In → Email để gửi xác nhận tới cả địa chỉ hiện tại và mới. Giữ Custom SMTP Resend đã hoạt động; không cần khóa mới. Giới hạn 30 ngày tính từ lần đổi email hoàn tất, độc lập với đổi tên. Luồng đổi email yêu cầu xác thực lại bằng mật khẩu hiện tại hoặc đúng tài khoản Google; sau khi đủ xác nhận, phiên Arena cũ bị thu hồi và người dùng đăng nhập lại.
