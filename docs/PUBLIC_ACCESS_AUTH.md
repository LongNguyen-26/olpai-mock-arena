# Truy cập công khai và xác thực

Cập nhật 06/11/2026. Web: https://olpaiarena.cyou. Supabase project `olpai-arena`, ref `prgbpkscymbihbhtando`.

| Chức năng | Khách | Đã đăng nhập |
| --- | --- | --- |
| Danh sách vòng, lịch, tổng quan | Xem vòng hiển thị | Xem vòng hiển thị |
| Nội dung đề | Sau giờ công bố | Cùng điều kiện; admin xem trước |
| BXH | Xem; private mở theo giai đoạn | Cùng điều kiện; admin có quyền quản trị |
| Dữ liệu, ZIP, notebook, link Drive | Yêu cầu đăng nhập | Đăng ký được duyệt và đúng giai đoạn phát |
| Đội, lời mời, hồ sơ, bài nộp | Yêu cầu đăng nhập | Theo tài khoản/đội; nộp bài theo vòng/quota |
| Workspace, JupyterLab, chatbot | Yêu cầu đăng nhập | Theo quyền cấp cho đội/vòng |
| Quản trị | Không truy cập | Chỉ admin trong database Arena |

Vòng ẩn/đã xóa trả 404. API khách không trả assets, link Drive, mã mời, thành viên/email, roster hoặc chi tiết bài nộp. BXH chỉ trả thông tin xếp hạng. Thông báo trong vòng giữ quyền theo đăng ký. Link Drive đã công khai/tệp đã tải trước đó có thể được chia sẻ ngoài web.

Khách bấm mục cần tài khoản thấy màn hình đăng nhập trong giao diện. Đăng nhập/đăng ký giữ vòng và mục đang xem qua `next`; server chỉ cho quay lại trang chủ nội bộ.

## Cấu hình trước khi bật

Mặc định `ARENA_AUTH_MODE=legacy` giữ luồng hiện có trong lúc Google/SMTP chưa sẵn sàng. Mã hỗ trợ email/password, xác nhận, gửi lại email, Google, quên/đặt lại mật khẩu.

1. [URL Configuration](https://supabase.com/dashboard/project/prgbpkscymbihbhtando/auth/url-configuration): Site URL `https://olpaiarena.cyou`; Redirect URL chính xác `https://olpaiarena.cyou/auth/callback`. Không wildcard production.
2. [Auth Providers](https://supabase.com/dashboard/project/prgbpkscymbihbhtando/auth/providers): bật email/password, **Confirm email**, xác nhận đổi email. Mật khẩu ứng dụng tối thiểu 10 ký tự.
3. Google Cloud OAuth Client loại Web application: Authorized JavaScript origin `https://olpaiarena.cyou`; Authorized redirect URI `https://prgbpkscymbihbhtando.supabase.co/auth/v1/callback`. Nhập Client ID/Client secret trực tiếp vào Google provider trong Supabase. Nếu consent còn Testing, thêm test users; hoàn tất trạng thái phát hành phù hợp trước khi mở rộng.
4. [Resend Domains](https://resend.com/domains): domain gửi phải verified. Chỉ dùng DNS record SPF/DKIM do Resend cấp; không thay DNS web. Cấu hình DMARC phù hợp; không đoán giá trị DNS.
5. [Supabase SMTP](https://supabase.com/dashboard/project/prgbpkscymbihbhtando/auth/smtp): Host `smtp.resend.com`, Port `465`, User `resend`, Password = Resend API key. Sender name `OlpAI Arena`; sender email `noreply@olpaiarena.cyou` nếu domain này verified, hoặc địa chỉ thuộc subdomain đã verified. Nhập secret trong Dashboard, không đưa vào chat/Git. Tắt click tracking cho email Auth để tránh sửa link xác nhận.
6. Email templates Confirm signup / Reset password giữ link `{{ .ConfirmationURL }}`. Có thể Việt hóa nội dung; không tự ghép link bỏ mã PKCE. Người dùng mở liên kết trên cùng trình duyệt đã khởi tạo. Phiên chờ xác thực 1 giờ; bắt đầu luồng mới trên cùng trình duyệt thay thế luồng đang chờ.
7. Render Environment: `SUPABASE_URL=https://prgbpkscymbihbhtando.supabase.co`, `SUPABASE_PUBLISHABLE_KEY` lấy từ API Keys (publishable, không service_role), `ARENA_AUTH_ORIGIN=https://olpaiarena.cyou`. Khi cấu hình provider đã xong, đặt `ARENA_AUTH_MODE=supabase`, `ARENA_GOOGLE_AUTH_ENABLED=true`, deploy một lần. Google secret và Resend key chỉ nằm ở Supabase.

Kiểm tra thật bằng email do người vận hành kiểm soát: nhận thư, xác nhận, quay lại đúng mục, logout/login, gửi lại và đặt lại mật khẩu. Google cần tương tác thật với tài khoản người vận hành. QA giả lập không thay các bước này. Không tắt Confirm email để chữa lỗi gửi thư.

## Tài khoản và quyền

Từ bản giao diện 07/11/2026, tài khoản Google được đưa tới `/onboarding` để tự nhập tên ở lần đầu. Không dùng tên tài khoản Google hay phần trước `@` trong email làm tên tự động. Tên đã chọn được chuẩn hóa khoảng trắng và giữ cho những lần sau; tài khoản chưa hoàn tất tên bị chặn thao tác riêng ở server. Tài khoản Arena cũ chủ động liên kết Google giữ tên đã có. Tài khoản Google được tạo trước bản này sẽ được hỏi tên một lần vào lần xác thực tiếp theo.

Tài khoản cũ giữ hash scrypt, ID, đội, bài nộp và admin. Đăng nhập mật khẩu cũ tiếp tục hoạt động. Sau khi Google được mở, vào **Tài khoản → Liên kết Google**; callback phải còn đúng phiên tài khoản đã bắt đầu. Không tự ghép theo email vì email lịch sử chưa xác minh. Google trùng email cũ sẽ hướng dẫn đăng nhập mật khẩu cũ rồi liên kết.

Tài khoản Supabase mới chỉ được tạo trong Arena sau xác thực thành công với email đã xác minh. Không sao chép mật khẩu vào Arena. `arena.auth_identities` ánh xạ Supabase subject với Arena user; backend-only, RLS theo namespace. Role/admin/team vẫn lấy từ Arena, không lấy từ `user_metadata` hoặc client.

Phiên Arena dùng cookie HttpOnly/Secure/SameSite=Lax, TTL 7 ngày như trước. Token provider chỉ ở bộ nhớ server; riêng access token reset dùng cookie HttpOnly 10 phút, xóa khi hoàn tất. Đặt lại/đổi mật khẩu Supabase thu hồi các phiên Arena của user. Xóa/revoke user chỉ ở Supabase không tự thu hồi phiên Arena; khi xử lý sự cố phải khóa/xóa user Arena hoặc xóa session tương ứng.

Quên mật khẩu qua email dành cho tài khoản mới dùng Supabase. Tài khoản lịch sử vẫn dùng mật khẩu cũ sau khi liên kết Google; không reset scrypt qua email lịch sử chưa xác minh. Tài khoản chỉ có Google nhận thư hướng dẫn đăng nhập Google; thêm mật khẩu tại Tài khoản bằng mã email một lần. Sau khi có mật khẩu, tài khoản này dùng được luồng khôi phục thông thường.

Backup SQL gồm ánh xạ đang hoạt động trong `sqlRuntime.auth_identities`; import sau users. Backup này không xuất kho mật khẩu/refresh token của `auth.users`; chuyển Supabase project cần kế hoạch Auth riêng. Công cụ hiện tại chặn rollback SQL runtime sang Redis production. Không đổi mode database để chữa Auth.

Ánh xạ có thêm `needs_name` và `name_confirmed_at` để lưu bước nhập tên. Khi đọc backup cũ có ba cột, công cụ bổ sung mặc định `false/null`; backup mới giữ cả hai trường. Quyền admin/đội vẫn được lấy từ các bảng Arena như trước.

## Mẫu email và khôi phục

Mã nguồn HTML tiếng Việt ở [email-templates](email-templates/README.md), gồm Confirm sign up và Reset password. Giữ nguyên `{{ .ConfirmationURL }}` khi dán vào Supabase. Cả hai loại thư được gửi bởi SMTP Resend hiện có. Thay mẫu chỉ là dán Source/Subject trong Supabase; không đặt Resend key vào web.

Ở màn hình chờ xác nhận, nút gửi lại là liên kết nhỏ, chờ 60 giây và hỏi xác nhận trước khi gửi. Server vẫn giới hạn tần suất độc lập với bộ đếm giao diện. Phần dữ liệu mờ chỉ có khung minh họa, không chứa tên tệp, dữ liệu hoặc đường dẫn tải thật.

## QA

`npm run typecheck`; `npx tsx --test --test-concurrency=1 tests/*.test.ts`; `npm run build`.

`npx tsx --env-file=.local/auth-qa.env scripts/qa-public-auth.ts` dùng PostgreSQL cục bộ trong namespace QA mới và Supabase Auth giả lập; không gửi email/Google thật, không tạo GPU. Tự dọn dữ liệu. `--keep` giữ server localhost 3113/3114 cho browser; dừng sạch bằng POST `http://127.0.0.1:3114/__qa/stop` (hoặc Ctrl+C trong terminal tương tác).

Nguồn: [Supabase Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Resend + Supabase](https://resend.com/docs/send-with-supabase-smtp).


## Chỉnh sửa tài khoản và OAuth branding — 07/11/2026

- `sessions.auth_provider` ghi phương thức đăng nhập Arena của từng phiên. Từ bản cập nhật phương thức đăng nhập, UI/API kiểm tra mật khẩu thực tế trong Supabase thay vì chặn theo phiên Google; tài khoản đã có mật khẩu đổi được sau khi xác thực bằng mật khẩu hiện tại. Các phiên trước migration nhận diện Google từ `auth_identities.google_account` cho đến lần đăng nhập mới.
- `/api/auth/name` cho phép đổi tên hợp lệ; SQL dùng thời gian database và transaction để bảo đảm 30 ngày/lần kể cả request đồng thời. Đổi email có đồng hồ riêng, chỉ bắt đầu 30 ngày sau khi thay đổi được xác nhận thành công.
- `/api/auth/change-email` yêu cầu mật khẩu hiện tại, hoặc Google OAuth xác thực lại đúng Supabase subject đang gắn với user. Pending request lưu ở `arena.account_profiles` (RLS backend theo namespace, không có token provider). Chặn email Arena trùng và pending email đang được giữ bởi user khác. Không giữ transaction SQL trong lúc gọi Auth.
- Supabase `updateUser({email})` gửi thư qua SMTP Resend. Template `Change email address` dùng `SiteURL` + `TokenHash` đến `/auth/email-change`; GET chỉ đặt cookie HttpOnly 10 phút rồi chuyển sang trang sạch token. POST cùng Origin mới gọi `verifyOtp(type:email_change)`, xử lý được xác nhận hai hộp thư. Chưa đủ xác nhận không đổi username; sau đủ xác nhận cập nhật theo subject, giữ user/team ID, thu hồi phiên Arena và yêu cầu đăng nhập lại.
- Callback PKCE cũ vẫn hỗ trợ mẫu `ConfirmationURL` nếu người vận hành chưa đổi template; dùng cùng trình duyệt và giữ verifier qua xác nhận đầu tiên. Mẫu TokenHash mới tránh việc email scanner tiêu thụ token chỉ bằng GET. Hướng dẫn và HTML ở `docs/email-templates/README.md` / `change-email.html`; giữ Confirm email và Secure email change.
- Tài khoản scrypt cũ cần liên kết Google trước khi đổi email qua luồng xác thực. Liên kết vẫn giữ mật khẩu scrypt/ID/lịch sử; không tự chuyển mật khẩu hoặc tin email chưa xác minh.
- Đội trưởng được rename đội ở API `team`, action `rename`; SQL và Redis đều kiểm tra captain tại thời điểm ghi. Giữ invite code, team ID và dữ liệu theo đội.
- Migration `20261107031944_arena_account_settings.sql`; backup đọc được identity/session cũ và giữ account_profiles/cooldown/provider khi export/restore SQL. Kho Supabase Auth/refresh token không nằm trong backup ứng dụng.
- Trang công khai `/privacy`, `/terms`, liên kết trang chủ và màn hình auth; thông tin điền Google ở `docs/OAUTH_BRANDING.md`. Logo PNG 120/512 xuất từ `src/app/icon.svg` bằng `node scripts/export-oauth-logo.mjs`. Chưa tự nộp/publish branding Google hoặc thay email template trong Dashboard.

## Phương thức đăng nhập — cập nhật 07/11/2026

Xem [ACCOUNT_AUTH_METHODS.md](ACCOUNT_AUTH_METHODS.md) để cấu hình mẫu Recovery/Magic Link và Redirect URLs trước khi phát hành các luồng mới. File HTML trong repo không tự đồng bộ với Supabase Dashboard. Người dùng đã chọn tự cập nhật cấu hình Supabase.
