# Tải GPU Workspace

Trang hiển thị khung chờ từ server bằng `app/loading.tsx`, trước khi `getUser()` hoàn tất. Khung chung chỉ có thương hiệu và các khối giữ chỗ, không có dữ liệu tài khoản hoặc quyền quản trị. Client đọc URL rồi hiện tên GPU Workspace trong khi chờ snapshot. Lỗi render/kết nối có khung phục hồi và nút thử lại.

Be Vietnam Pro và IBM Plex Mono được đóng gói bằng Fontsource, phục vụ qua static assets của website với `font-display:swap`. Không còn CSS `@import` chặn render từ Google Fonts; browser có thể vẽ khung bằng font dự phòng trong khi tệp font nội bộ tải về.

Sau khi có dữ liệu tài khoản, Workspace giữ tiêu đề, điều hướng và skeleton trong lúc tải danh sách. Không hiện trạng thái rỗng hoặc số lượng giả trước khi dữ liệu về. Đọc snapshot, Workspace, lịch sử GPU, danh sách đội và giá có timeout 20 giây; quá 8 giây, màn hình chờ chính có thông báo tải lâu. Lỗi Workspace, lịch sử và giá có phạm vi riêng và cách thử lại; lỗi giá không khóa Chatbot/JupyterLab đã cấp.

## Dữ liệu ưu tiên

- UI gọi `GET /api/workspace/state?view=current` trước. Chỉ các Workspace chưa thu hồi được trình bày và đọc telemetry worker; nhóm Chatbot, cấu hình và quyền hiện tại đi cùng response.
- `view=history` chỉ tải khi mở **Đã thu hồi**; không tải nhóm/queue/template/credential cho màn hình lịch sử. `counts.current/history` luôn tính theo phạm vi người dùng và vòng được phép nhìn thấy. Không đọc telemetry worker của Pod đã thu hồi.
- Bỏ tham số hoặc `view=all` giữ API đầy đủ để tương thích công cụ hiện có; giá trị view khác bị chặn 400. Lịch sử trò chuyện theo đội/vòng là chức năng riêng, không bị thay retention hoặc xóa dữ liệu.
- Kiểm tra số lượng dùng dữ liệu vòng đọc theo lô; các hàng đang xem vẫn kiểm tra chính sách hiện hành trước khi trả DTO. Các phần đọc độc lập chạy song song. Giá Runpod và sync Pod chạy riêng sau snapshot; không gọi inference để mở trang.

## Quay lại và làm mới

Workspace đã mở được giữ trong cây React của trang khi chuyển mục, và ẩn khi không dùng. Khi quay lại, nội dung trước hiện ngay kèm thời điểm cập nhật; đọc lại trạng thái nền. Không dùng cache toàn cục ở server, localStorage hoặc cache chung giữa tài khoản. Cây được tạo lại khi user ID, vai trò admin hoặc team ID thay đổi; đăng xuất/chuyển trang toàn phần cũng xóa bộ nhớ này.

Polling, sync và đọc giá dừng khi Workspace ẩn. Request đọc có hủy khi rời mục, có một request đang chạy cho từng phần; focus hoặc interval không tạo request trùng. Kết quả đã hủy không cập nhật UI. Form Runpod xóa bản nháp API key khi rời mục; form Groq được unmount.

Khi quay lại, các thao tác quản trị bị khóa cho tới khi snapshot mới về. Nếu đọc lỗi, dữ liệu trước được giữ để xem, có thông báo và nút thử lại. Backend vẫn kiểm tra quyền, run/revision, reservation và giá trước mọi thao tác; dữ liệu cũ trên màn hình không cấp quyền thực hiện mutation.

## Kiểm tra

`scripts/qa-workspace-loading.ts` dùng Supabase/Redis thật trong namespace ngẫu nhiên, kiểm tra 90 Workspace, tách current/history, counts, đội khác, vòng ẩn/đã xóa, telemetry và redaction. Mọi provider call bị cấm trong script; tự dọn trừ khi truyền `--keep` cho browser QA.

`scripts/qa-workspace-loading-ui.js` dùng snapshot QA thật, giữ hoặc trả lỗi response có kiểm soát và chặn mutation/provider. Kiểm tra shell, skeleton desktop/mobile, lazy history, retry, giá độc lập, quay lại từ cache, dừng polling khi ẩn, single flight qua focus/interval và khóa thao tác khi dữ liệu cũ. Ảnh nội bộ trong `output/playwright/workspace-loading-*.png`. Fixture, cookie và khóa chỉ ở `.local/`, phải đăng xuất và dọn sau kiểm tra.
