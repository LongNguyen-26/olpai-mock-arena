# Mẫu email Supabase / Resend

Hai tệp HTML là mã nguồn để dán nguyên vào **Body → Source** ở Supabase Authentication → Emails. Có thể chỉnh câu chữ/màu/spacing trực tiếp trong HTML.

| Template trong Supabase | Subject gợi ý | Body Source |
| --- | --- | --- |
| Confirm sign up | Xác nhận email — OlpAI Arena | `confirm-signup.html` |
| Reset password | Đặt lại mật khẩu — OlpAI Arena | `reset-password.html` |

Giữ nguyên biến `{{ .ConfirmationURL }}` trong các liên kết. Supabase tạo liên kết xác thực; Resend gửi cả email xác nhận và email khôi phục qua cùng Custom SMTP đang cấu hình. Không cần thêm Resend API key vào frontend hoặc thay Google client.

Luồng khôi phục: **Quên mật khẩu → nhập email → nhận thư Reset password → mở link trên cùng trình duyệt → chọn mật khẩu mới → đăng nhập lại**. Các phiên Arena cũ bị thu hồi sau khi lưu mật khẩu mới. Dành cho tài khoản Supabase, gồm tài khoản Google muốn thêm mật khẩu; tài khoản scrypt lịch sử không được reset qua email chưa xác minh.

Trong trang SMTP, giữ sender thuộc domain đã xác minh. Tắt click tracking cho email Auth để dịch vụ gửi thư không sửa liên kết. Bản mẫu không có tài nguyên từ bên ngoài hoặc JavaScript. Preview trình duyệt không thay kiểm tra hiển thị thực tế trong mọi ứng dụng email.

Sau khi dán và Save, kiểm tra riêng một email Confirm sign up và một email Reset password. Bản ZIP bàn giao giữ placeholder của Supabase, không chứa email người dùng, mật khẩu hoặc mã xác thực thật.
