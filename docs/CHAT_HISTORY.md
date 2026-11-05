# Lịch sử trò chuyện của đội

Chatbot có thanh lịch sử bên trái, chung cho các thành viên hiện tại của một đội trong một vòng luyện. Điện thoại mở thanh này bằng nút lịch sử. Tiêu đề lấy từ câu hỏi đầu tiên; danh sách tải 50 cuộc mỗi trang. Chọn cuộc trò chuyện để xem hoặc tiếp tục nếu cùng dịch vụ, cùng lượt luyện và quyền Chatbot đang mở.

Mỗi tab/máy mới vẫn tự tạo UUID trong sessionStorage. Refresh giữ cuộc đang chọn; **Đoạn chat mới** hoặc `/new` tạo UUID khác và giữ toàn bộ lịch sử cũ. Chọn một cuộc trong thanh lịch sử là thao tác chủ động mở phiên chung của đội. Admin có lịch sử riêng theo tài khoản, không dùng lane token của đội.

Góc trên phải hiển thị token còn lại **của cuộc trò chuyện đang xem**, theo ngân sách phiên đã cấu hình, gồm cả input và output. Trong lúc xử lý, phần dự phòng đã giữ được trừ khỏi số còn lại; khi hoàn tất, hệ thống đối soát như trước. Góc dưới phải ô nhập đếm ký tự Unicode, gồm khoảng trắng và xuống dòng; đây không phải phép đếm token.

Kết thúc vòng, đổi run khi đặt lại, hoặc đóng dịch vụ không xóa lịch sử. Cuộc ở run/dịch vụ cũ là chỉ đọc và giữ thống kê token của nó; cuộc ở run hiện tại có thể tiếp tục khi quyền được mở lại. Link **Xem lịch sử trò chuyện** vẫn mở được sau khi quyền gửi tin nhắn đóng. Vòng bị ẩn và quyền theo đội vẫn được kiểm tra ở server.

## Dữ liệu và quyền

- `GET /api/workspace/chat/history`: chọn đúng một `id` hoặc `groupId`; `cursor` tải trang tiếp, `conversation` đọc một cuộc. Tham chiếu là cặp kind/id mã hóa base64url, không phải credential; server luôn kiểm tra lại namespace, vòng và audience. Đổi tham chiếu không cho phép đọc đội/vòng khác.
- Dùng bảng `arena.runtime_history` hiện có, hai kind `chat-session` và `chat-group-session`. Snapshot có `conversation` gồm round/run, target, audience, session ID, tiêu đề, thời gian và chính sách token. Migration `durable_team_chat_history` bổ sung chỉ mục theo vòng/audience/thời gian.
- Snapshot cuộc trò chuyện có `expires_at=null`; job, lease và bản ghi tạm vẫn giữ TTL. Redis session có metadata cũng không hết hạn. Khi cache mất, đọc snapshot SQL và phục hồi context mà không gọi lại model hoặc đặt lại usage. Cache legacy được ghép metadata SQL bằng Lua, giữ nguyên messages/usage mới hơn.
- Backup/export/import giữ retention vĩnh viễn và routing metadata, kể cả cache Redis legacy còn TTL. Reset vòng không xóa các snapshot này. Dữ liệu này tiếp tục nằm trong backup hiện có; chưa thêm tính năng xóa cuộc trò chuyện trên UI.
- Migration gắn lại lịch sử cũ bằng job ledger hoặc key Pod chung có audience tường minh. Các snapshot private cũ không có bằng chứng chủ sở hữu được giữ nhưng không tự đưa vào sidebar của đội/admin. Không đoán chủ sở hữu vì có thể lộ cuộc trò chuyện.

Thí sinh chỉ thấy **Trợ lý AI** và thông tin cần dùng. Tên nhà cung cấp, model, tên cấu hình do admin nhập, token-accounting mode và metadata nội bộ không nằm trong DTO chat của thí sinh. Admin vẫn xem được thông tin Groq/Runpod. Nội dung câu hỏi/câu trả lời được giữ nguyên; không sửa transcript nếu chính người dùng hoặc model nhắc tên nhà cung cấp.

## Kiểm tra

```
npx tsx --env-file=.env --env-file=.local/supabase-runtime.env scripts/qa-chat-history.ts
```

Script dùng Supabase/Redis thật trong namespace QA ngẫu nhiên, giả lập model và tự dọn. Có kiểm tra chia sẻ cùng đội, chặn đội/vòng khác, tách admin, cache eviction/legacy, usage, chat mới, finish/reset/retire và backup. `--keep` chỉ dành cho browser QA; fixture có secret phải ở `.local/`, không commit.

Browser: `scripts/qa-chat-history-ui.js` chạy trong Playwright CLI trên fixture QA đã đăng nhập. Worker QA riêng hoàn tất bằng phản hồi giả lập. Kiểm tra desktop/mobile, refresh, ký tự Unicode, chỉ đọc, hai browser context, lịch sử chung, phản hồi đến muộn và đội khác; ảnh ở `output/playwright/chat-history-*.png`. Không gọi provider thật hoặc tạo GPU để kiểm thử.
