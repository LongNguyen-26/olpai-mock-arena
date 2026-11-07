# Mẫu email Supabase / Resend

Bốn tệp HTML là mã nguồn để dán nguyên vào **Body → Source** ở Supabase Authentication → Emails. Có thể chỉnh câu chữ/màu/spacing trực tiếp trong HTML.

| Template trong Supabase | Subject gợi ý | Body Source |
| --- | --- | --- |
| Confirm sign up | Xác nhận email — OlpAI Arena | `confirm-signup.html` |
| Reset password | Hướng dẫn truy cập tài khoản — OlpAI Arena | `reset-password.html` |
| Magic Link | Mã xác nhận — OlpAI Arena | `magic-link.html` |
| Change email address | Xác nhận thay đổi email — OlpAI Arena | `change-email.html` |

Giữ `{{ .ConfirmationURL }}` trong Confirm sign up và nhánh khôi phục thông thường của Recovery. Magic Link dùng `Token`/`TokenHash` theo mẫu riêng. Supabase tạo liên kết xác thực; Resend gửi cả email xác nhận và email khôi phục qua cùng Custom SMTP đang cấu hình. Không cần thêm Resend API key vào frontend hoặc thay Google client.

Luồng khôi phục: **Quên mật khẩu → nhập email → nhận thư Reset password → mở link trên cùng trình duyệt → chọn mật khẩu mới → đăng nhập lại**. Các phiên Arena cũ bị thu hồi sau khi lưu mật khẩu mới. Dành cho tài khoản Supabase đã có mật khẩu, gồm tài khoản Google đã thiết lập thêm mật khẩu; tài khoản scrypt lịch sử không được reset qua email chưa xác minh.

Trong trang SMTP, giữ sender thuộc domain đã xác minh. Tắt click tracking cho email Auth để dịch vụ gửi thư không sửa liên kết. Bản mẫu không có JavaScript, dùng CSS inline và bảng trình bày; ảnh logo PNG tải từ chính `https://olpaiarena.cyou/branding/olpai-arena-oauth-120.png?v=night-blue-20261107`. Tên OlpAI Arena vẫn hiển thị bằng chữ nếu ứng dụng email chặn ảnh. Preview trình duyệt không thay kiểm tra hiển thị thực tế trong mọi ứng dụng email.

Sau khi dán và Save, kiểm tra riêng Confirm sign up, Reset password (cả tài khoản có mật khẩu và chỉ dùng Google), Magic Link/OTP, thiết lập mật khẩu và Change email address. Bản ZIP bàn giao giữ placeholder của Supabase, không chứa email người dùng, mật khẩu hoặc mã xác thực thật.

## Bộ nhận diện đã duyệt ngày 07/11/2026

Nền xám lạnh `#eef1f4`, header/nút xanh đêm `#1d2f3d`, monogram A mới với điểm nhấn cam sáng `#ff9b62`. Nhãn nhỏ trên nền trắng dùng cam đậm `#b45225` để dễ đọc. Chỉ wordmark dùng Georgia để tương thích email; nội dung giữ Arial/Helvetica. Hai tệp PNG OAuth 120×120 và 512×512 nằm trong `public/branding/`, được đóng gói cùng bốn HTML để bàn giao.

Biến mẫu được đối chiếu với [tài liệu Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates); lần cập nhật này chỉ đổi nhận diện, giữ nguyên URL xác thực và câu chữ hướng dẫn các luồng hiện có. Người dùng tự cập nhật mẫu trên Supabase và logo trong Google Auth Platform → Branding; việc deploy web không tự thay hai cấu hình này.

## Change email address

Subject: Xác nhận thay đổi email — OlpAI Arena. Dán change-email.html vào Authentication → Emails → Change email address → Body → Source.

Giữ nguyên {{ .SiteURL }}, {{ .TokenHash }}, {{ .Email }}, {{ .NewEmail }}. Mẫu mới dùng liên kết /auth/email-change với TokenHash để xác nhận trên một trang có nút bấm, tránh trình quét email tự tiêu thụ liên kết; không đổi mẫu này sang ConfirmationURL nếu muốn giữ cơ chế đó. Site URL cần là https://olpaiarena.cyou (không thêm dấu / ở cuối). Hai mẫu đăng ký/khôi phục cũ vẫn giữ ConfirmationURL.

Bật Confirm email và Secure email change trong Authentication → Providers/Sign In → Email để gửi xác nhận tới cả địa chỉ hiện tại và mới. Giữ Custom SMTP Resend đã hoạt động; không cần khóa mới. Giới hạn 30 ngày tính từ lần đổi email hoàn tất, độc lập với đổi tên. Luồng đổi email yêu cầu xác thực lại bằng mật khẩu hiện tại hoặc đúng tài khoản Google; sau khi đủ xác nhận, phiên Arena cũ bị thu hồi và người dùng đăng nhập lại.

## Hai mẫu cần cập nhật cho phương thức đăng nhập mới

Người dùng chọn tự cập nhật Supabase. Dán toàn bộ Source của `reset-password.html` vào **Reset password**, và `magic-link.html` vào **Magic Link**. Subject Recovery nên dùng “Hướng dẫn truy cập tài khoản — OlpAI Arena” vì cùng mẫu phục vụ hai tình huống.

Trong URL Configuration giữ Site URL chính xác `https://olpaiarena.cyou` (không dấu `/` cuối), giữ redirect callback đang có, thêm hai URL chính xác:

- `https://olpaiarena.cyou/auth/callback?intent=google-reminder`
- `https://olpaiarena.cyou/auth/callback?intent=password-setup`

Recovery dùng điều kiện Go template trên `.RedirectTo`: nhánh `google-reminder` chỉ có hướng dẫn đăng nhập Google và thiết lập mật khẩu, không chứa token/nút khôi phục. Nhánh còn lại giữ `ConfirmationURL` cho khôi phục PKCE trên cùng trình duyệt. Backend còn kiểm tra tài khoản thực sự có mật khẩu ở cả callback và endpoint lưu mật khẩu.

Magic Link dùng chung một template: thư đăng nhập chứa `Token` và URL `/auth/email-login?token_hash=...`; thư `password-setup` chỉ chứa mã và hướng dẫn đặt mật khẩu trong Tài khoản. Không dùng `user_metadata` để quyết định loại tài khoản. Không xóa các điều kiện `if/else/end` khi dán Source.

Giữ SMTP, Google, Confirm email và Secure email change hiện có. Đề xuất Email OTP Expiration 600 giây; giới hạn gửi lại của ứng dụng là 60 giây. Chỉ gửi thử bằng địa chỉ email do người vận hành kiểm soát.

Chi tiết và tình trạng triển khai: [ACCOUNT_AUTH_METHODS.md](../ACCOUNT_AUTH_METHODS.md).
