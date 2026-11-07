# Tài khoản, Google, mật khẩu và email một lần

Cập nhật 07/11/2026. Người dùng đã xác nhận **lưu xong cấu hình Supabase** trước khi yêu cầu phát hành bản web này. Kiểm thử hiện tại dùng PostgreSQL cục bộ, Supabase Auth/SMTP giả lập; chưa chứng minh email thật đã nhận được.

## Cấu hình cần thực hiện trên Supabase

Project: `olpai-arena` / `prgbpkscymbihbhtando`.

1. Mở [Email templates](https://supabase.com/dashboard/project/prgbpkscymbihbhtando/auth/templates). Trong **Reset password → Source**, thay bằng toàn bộ [reset-password.html](email-templates/reset-password.html). Subject: **Hướng dẫn truy cập tài khoản — OlpAI Arena**. Lưu cả điều kiện `if/else/end` của mẫu.
2. Trong **Magic Link → Source**, thay bằng toàn bộ [magic-link.html](email-templates/magic-link.html). Subject: **Mã xác nhận — OlpAI Arena**. Mẫu này dùng cho cả đăng nhập và xác minh trước khi thêm mật khẩu.
3. Mở [URL Configuration](https://supabase.com/dashboard/project/prgbpkscymbihbhtando/auth/url-configuration). Site URL: `https://olpaiarena.cyou` (không dấu `/` cuối). Giữ mọi redirect URL hiện có, thêm chính xác:
   - `https://olpaiarena.cyou/auth/callback?intent=google-reminder`
   - `https://olpaiarena.cyou/auth/callback?intent=password-setup`
4. Giữ SMTP Resend/Google/Confirm email/Secure email change hiện có. Đề xuất Email OTP Expiration **600 giây**. Không cần API key mới trong website.

Đường dẫn `/auth/email-login` nằm trực tiếp trong mẫu email, dùng TokenHash. Nó không phải redirect OAuth; không cần wildcard hay thay redirect URI trong Google Cloud.

Mẫu mới có thể lưu trước bản web mới. Nên phát hành web ngay sau khi lưu để liên kết `/auth/email-login` đã được phục vụ khi người dùng mở thư.

## Hành vi tài khoản

| Trạng thái | Tài khoản & bảo mật | Quên mật khẩu |
| --- | --- | --- |
| Email + mật khẩu Supabase | Email xác minh, đổi email, đổi mật khẩu bằng mật khẩu hiện tại, OTP/Magic Link | Thư đặt lại mật khẩu |
| Chỉ Google, chưa đặt mật khẩu | Google đã liên kết; email chỉ đọc; nút Thiết lập mật khẩu; OTP/Magic Link | Thư nhắc dùng **Tiếp tục với Google**, hướng dẫn thiết lập mật khẩu trong Tài khoản |
| Google đã thêm mật khẩu | Google vẫn dùng được; email + mật khẩu và OTP/Magic Link cùng dùng được; cho đổi mật khẩu | Thư đặt lại mật khẩu |
| Arena lịch sử dùng scrypt | Giữ mật khẩu/ID/đội/lịch sử; có thể chủ động liên kết Google như trước | Không reset scrypt bằng email lịch sử; liên hệ quản trị viên |

Trạng thái dựa vào khả năng đăng nhập thực tế, không phụ thuộc phiên vừa đăng nhập bằng Google hay email.

Thêm mật khẩu: **Tài khoản → Thiết lập mật khẩu → Gửi mã xác nhận → nhập mã + mật khẩu mới + nhập lại → Lưu**. Mã phải thuộc đúng Supabase subject đang gắn với phiên Arena. Mật khẩu tối thiểu 10 ký tự; Supabase lưu hash, Arena không sao chép mật khẩu. Sau khi lưu, các phiên Arena cũ bị thu hồi và phiên hiện tại được cấp lại. Google vẫn liên kết, không tạo thêm Arena user/team.

OTP/Magic Link chỉ đăng nhập tài khoản Supabase đã đăng ký (`shouldCreateUser:false`). Response yêu cầu gửi thư không tiết lộ email có tồn tại hay phương thức của tài khoản. Chặn thử mã theo IP/email và giới hạn gửi lại 60 giây. Supabase kiểm tra thời hạn và tính một lần của token. Đăng ký mới vẫn qua form đăng ký/Google và xác minh như trước.

Magic Link dùng GET để lưu TokenHash trong cookie HttpOnly 10 phút, chuyển sang URL sạch; chỉ POST cùng Origin sau nút **Xác nhận đăng nhập** mới dùng token. Trình quét email GET không tiêu thụ token. Có thể mở trên máy khác mà không cần verifier của trình duyệt gốc. Cùng trình duyệt giữ `next` nếu còn flow; khác trình duyệt về trang chủ. Các luồng đăng ký/khôi phục cũ vẫn dùng PKCE và cần trình duyệt gốc.

## Database và quyền

Migration `20261107064210_arena_auth_methods.sql` đã thêm hàm chỉ đọc `arena.account_auth_state(text)` vào Supabase. Không đổi mật khẩu hay ánh xạ của người dùng đang có. Hàm trả ba boolean: email xác minh, có mật khẩu, liên kết Google. Không đọc hash hoặc token ra ứng dụng.

Hàm cần `SECURITY DEFINER` để đọc Auth từ role backend hạn chế. Nó ở schema `arena` không công khai Data API, cố định `search_path`, bắt buộc đúng mapping user và namespace backend, chỉ xét user đang hoạt động. Đã thu hồi EXECUTE của PUBLIC/anon/authenticated; chỉ `arena_backend` có quyền. Quyền admin/đội tiếp tục lấy từ Arena. Không dùng `user_metadata` hay sự tồn tại của email identity để suy luận có mật khẩu.

Backup ứng dụng giữ thêm cột `school` trong `account_profiles`, tự bổ sung null khi đọc bản sao lưu cũ; trạng thái Auth lấy từ `auth.users` khi đọc. Kho Supabase Auth vẫn cần kế hoạch backup riêng như trước.

## Kiểm tra

- `npm run typecheck`, `npm test`, `npm run build`.
- `npx tsx --env-file=.local/auth-qa.env scripts/qa-account-settings.ts [--keep]`: PostgreSQL cục bộ + Auth/SMTP giả lập. Kiểm tra Google thêm mật khẩu, sai mã/nhập lại/replay, thu hồi phiên, cùng ID/đội, Google email chỉ đọc, recovery chọn đúng loại thư, OTP/Magic Link khác trình duyệt và bảo vệ email scanner. Tự dọn fixture khi kết thúc; `--keep` giữ để QA browser.
- `npx tsx --env-file=.local/auth-qa.env scripts/qa-public-auth.ts`: hồi quy đăng ký/khôi phục, onboarding, collision, PKCE và phân quyền.
- `playwright-cli -s=authmethods run-code --filename scripts/qa-auth-methods-ui.js` sau khi mở localhost 3123 trong session đó: UI thật gọi API/database cục bộ; kiểm tra desktop 1440px/mobile 390px, OTP, form password, trạng thái Google, không tràn ngang/lỗi JS/HTTP 5xx. Ảnh `output/playwright/auth-methods-*.png` là fixture QA.

`scripts/qa-auth-fixtures.ts` buộc URL database Auth fixture thuộc loopback. Không tạo Auth users giả ở Supabase production. `.local/auth-qa.env` trỏ cả app database và fixture database vào PostgreSQL dùng riêng trên máy. Xem `scripts/setup-auth-qa.ts` để tạo schema từ migrations trên cluster QA mới.

Sau cập nhật cấu hình và phát hành web, cần kiểm tra email thật bằng địa chỉ người vận hành kiểm soát: email/password recovery, Google-only reminder, mã thiết lập mật khẩu, OTP, Magic Link trên máy khác, mã hết hạn/đã dùng. Chưa gửi email thật trong QA tự động.

Nguồn: [Supabase identity linking và thêm mật khẩu OAuth](https://supabase.com/docs/guides/auth/auth-identity-linking), [OTP/Magic Link](https://supabase.com/docs/guides/auth/auth-email-passwordless), [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

### Tạo cluster QA trên Windows

Ví dụ khi đã cài PostgreSQL 18 (cluster và log nằm trong `.local/`, không dùng database thật):

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\initdb.exe' -D .local/qa-auth-postgres-isolated --auth=trust --username=qa_admin --encoding=UTF8 --locale=C
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D .local/qa-auth-postgres-isolated -l .local/qa-auth-postgres.log -o '-p 55437 -h 127.0.0.1' start
$env:ARENA_QA_AUTH_DATABASE_URL='postgresql://qa_admin@127.0.0.1:55437/postgres'
npx tsx scripts/setup-auth-qa.ts
```

Cluster chỉ lắng nghe loopback. Cấu hình `trust` chỉ dành cho cluster dùng một lần ở máy thử. Script setup yêu cầu database mới; không thay schema đã có. Sau QA, dừng cluster:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D .local/qa-auth-postgres-isolated stop -m fast
```


## Thông tin trường và bố cục Tài khoản

Theo yêu cầu bổ sung ngày 07/11, **Trường** là ô nhập tự do tối đa 160 ký tự, không bắt buộc. Người dùng có thể cập nhật hoặc xóa để trống trong Thông tin cá nhân. API `/api/auth/school` chỉ sửa hồ sơ của user đang đăng nhập, chuẩn hóa khoảng trắng/Unicode và giới hạn tần suất; thay trường không dùng hạn đổi tên 30 ngày. Giá trị lưu ở `arena.account_profiles.school`, giữ RLS backend/namespace có sẵn. Bản lưu cũ không có trường này được đọc là null. Tài khoản Arena lịch sử cũng dùng được trường hồ sơ này.

Trang sử dụng một bảng chung chiếm toàn bộ chiều rộng nội dung. Nhãn Tên hiển thị/Trường/Email nằm phía trên; giá trị tương ứng đặt trong ô chữ nhật bo góc cùng nút sửa. Các mục ngăn cách bằng khoảng trắng và đường phân chia giữa thông tin cá nhân với bảo mật, không tách mỗi mục thành một thẻ riêng. Heading 28–32px, nhãn 21px, giá trị 22px; mobile giảm vừa phải để dễ đọc. Form mật khẩu mới dùng hai cột trên desktop, một cột trên điện thoại; nút có vùng bấm tối thiểu 44px. Luồng Auth không phụ thuộc bố cục.
