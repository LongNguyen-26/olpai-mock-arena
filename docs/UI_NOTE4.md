# Cập nhật giao diện theo .note4.txt — 27/10/2026

## Vòng luyện

- Thẻ gọn hơn, nhấn vào thẻ hoặc nút lớn để mở vòng.
- Hiển thị trạng thái theo đồng hồ server và đếm ngược bắt đầu/kết thúc. Hỗ trợ mở private sớm, kết thúc sớm và vòng không giới hạn.
- Số thí sinh đăng ký gồm đăng ký được duyệt và chờ duyệt; bỏ đăng ký bị từ chối và tài khoản admin. API chỉ trả số lượng và đăng ký của người đang xem.
- Đồng hồ trong trang tổng quan hiển thị thời gian còn lại của toàn vòng.
- Nút vào vòng luyện căn trái theo vạch chia ở cột đồng hồ. Đăng ký được đưa lên hàng đầu; lịch bắt đầu dưới đồng hồ ghi đầy đủ giờ, ngày, tháng, năm theo múi giờ Việt Nam. Ba thông tin thời lượng/tác vụ/số đăng ký tăng lên 14px. Bỏ dòng chuyển private theo yêu cầu bổ sung.

## GPU Workspace

- Bỏ khối khẩu hiệu TEAM COMPUTE. Đưa danh sách GPU lên trước cấu hình admin.
- Hai mục **GPU hiện tại** và **Đã thu hồi**. GPU đang dừng hoặc đang cấp phát vẫn nằm trong mục hiện tại để theo dõi và điều khiển.
- Nhãn GPU hiện tại giữ một dòng, kể cả trên màn hình mobile.
- Khi chưa được cấp GPU vẫn hiển thị thẻ GPU chưa bật với Chatbot và JupyterLab bị khóa.
- Mỗi GPU có một hàng riêng: nhận diện GPU/đội/vòng, telemetry/uptime/chi phí và hai ô dịch vụ có biểu tượng, tín hiệu trạng thái, mô tả, nút truy cập.
- Dịch vụ không được cấp, đang khởi động hoặc bị khóa theo lịch/quyền truy cập hiển thị rõ, không có liên kết truy cập hoạt động. Không lấy trạng thái Pod chạy làm bằng chứng dịch vụ sẵn sàng.

## Chatbot

- Bỏ nút Về Workspace và thanh theo dõi token. Đưa trạng thái DeepSeek và nút **Đoạn chat mới** lên đầu trang.
- Tin gửi xuất hiện ngay và xóa nội dung ô nhập khi gửi; hội thoại tự cuộn trong vùng tin nhắn. Giữ Enter để gửi, Shift+Enter để xuống dòng và xử lý IME.
- Khi lỗi, bỏ tin tạm và khôi phục câu hỏi vào ô nhập nếu chưa có bản nháp mới. Không tự gửi lại yêu cầu suy luận.
- Lọc khối `<think>`, thẻ điều khiển model khỏi câu trả lời hiển thị; giữ ví dụ trong Markdown/code. Lịch sử lưu trên server và cách tính token không thay đổi. `/usage`, `/limits`, `/new`, `/help` vẫn dùng được.
- Thu hẹp cột tin nhắn, cố định vùng soạn ở đáy và có chỉ báo đang suy luận; hỗ trợ reduced motion.
- Kết hợp cơ chế `chatSession`: UUID riêng cho mỗi máy/tab, refresh giữ phiên, “Đoạn chat mới”/`/new` tạo phiên trắng và không ảnh hưởng máy khác. Giữ nguyên UI mới khi áp dụng cơ chế này.

## Kiểm tra

- `npm test`: 34/34 bài đạt. Có kiểm tra qua SDK Redis với HTTP giả lập cho số đăng ký và quyền riêng tư; kiểm tra mốc thời gian và xử lý nội dung model.
- `npm run typecheck`: đạt.
- `npm run build`: đạt; tuyến preview QA không nằm trong bản build. Build được chạy ngoài sandbox sau khi lần chạy trong sandbox gặp EPERM ở thư mục prerender sinh tự động.
- Playwright trên Edge, desktop 1600×1000 và mobile 390×844: vào vòng, GPU chưa cấp/đang chạy/đã dừng/thu hồi, admin nhiều GPU, khóa dịch vụ, chat chậm, không lặp tin, lỗi và khôi phục bản nháp, đoạn chat mới, lệnh token, xuống dòng, cuộn hội thoại dài và không tràn ngang đều đạt.
- Trình duyệt dùng API giả lập. Telemetry, số người đăng ký và phản hồi trong ảnh là dữ liệu QA; không phải số đo GPU hoặc kết quả suy luận thật. Không thực hiện thay đổi Pod hay dữ liệu production.
- Ảnh QA lưu trong `output/playwright/note4-*.png`; kịch bản kiểm tra cục bộ trong `.local/qa-note4-ui.js` và `.local/qa-note4-edge.js`. Trang preview tạm đã được gỡ khỏi mã nguồn ứng dụng.

## Nộp bài

- Điểm ở lịch sử dùng Be Vietnam Pro 16px, weight 700, chữ số tabular; điểm kết quả dùng weight 800.
- Trạng thái hợp lệ/không hợp lệ giảm xuống 12px, biểu tượng 14px.
- QA bổ sung: `.local/qa-note4-refinements.js`; ảnh `output/playwright/note4-refined-*.png`. Đã kiểm tra căn nút, vị trí đăng ký, ngày có năm, bỏ dòng private, typography và mobile không tràn ngang.

## Phát hành production

- URL: https://olpai-mock-arena.vercel.app
- Deployment: `dpl_449p9wRvewwCUFejtRFTQNardcm1`, trạng thái `READY`, hoàn tất ngày 27/10/2026.
- Phát hành trực tiếp mã nguồn local đã kiểm tra qua Vercel MCP; base commit `ccc0f629e1f3b6d266c5246d04bfc5212b8a974e` cùng thay đổi chưa commit.
- Source SHA-256: `f704ee2a7247c0f205e0b1c28802659b6922c194cbf95e79e62b4c7576815b8f`.
- Kiểm tra production: login 200, API không đăng nhập 401, API sau đăng nhập 200, dữ liệu số đăng ký hợp lệ, CSS/JS mới đúng phiên bản, trang preview tạm 404. Không tạo bài nộp hoặc gọi điều khiển Pod.
- Biên bản HTTP tại `.local/note4-deployment/production-verification.json`; mã đóng gói chỉ gồm 42 tệp source/config/lock cần thiết, không gồm dữ liệu QA hay thông tin đăng nhập.

## Khôi phục và hợp nhất UI với phiên chat riêng — 28/10/2026

- Bản UI 27/10 đã phát hành từ working tree nhưng chưa được commit. Hai commit tách chat sau đó giữ thay đổi local, song Git integration chỉ phát hành nội dung đã commit nên UI production quay về bản trước.
- Đối chiếu snapshot phát hành `f704ee2a…`: 41/42 tệp vẫn trùng bản UI đúng; tệp còn lại là `workspace-chat.tsx`, đã kết hợp UI mới với helper `chatSession` của commit `2d85f21`. Giữ nguyên các cập nhật `AGENTS.md` và commit kiểm tra `90e3649`.
- Typecheck, 37 unit tests và build production đạt. Kiểm tra Playwright trên cùng bản kết hợp: UI vòng luyện/GPU/nộp bài desktop/mobile, gửi chat hiển thị ngay, lọc thẻ model, hai tab/hai browser context riêng, refresh, `/new` và bỏ qua response lịch sử cũ đến muộn đều đạt. Các API inference/Pod trong QA được giả lập.
- Toàn bộ source, CSS, helper và tests của UI cần nằm trong commit phát hành cùng cơ chế phiên chat. Phát hành qua push `main`, xác minh full SHA và `READY`; không phát hành lại một bản chỉ có thay đổi chat từ HEAD cũ.
