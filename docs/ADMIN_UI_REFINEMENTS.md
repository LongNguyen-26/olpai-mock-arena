# Điều chỉnh giao diện và quản trị ngày 28/10/2026

- Bảng lịch sử nộp và BXH: tiêu đề 15px/700, nhãn `Bản nộp/Thời gian`; cột Tác vụ, Bộ kiểm thử và Điểm căn giữa. Điểm BXH dùng Be Vietnam Pro đậm, chữ số tabular; tổng điểm lớn hơn các điểm tác vụ.
- Bỏ lý do dưới hàng Không hợp lệ; lỗi của lượt đang nộp vẫn hiện trong màn hình kết quả để người dùng sửa CSV. Ô nộp, số điểm, nút nộp và nút tiếp tục có thứ bậc chữ/kích thước rõ hơn.
- Thương hiệu `OlpAI Arena`. Email dùng làm tên đăng nhập mới; tên đăng nhập cũ vẫn hoạt động. Mời thành viên nhận cả email và tên cũ, tối đa 254 ký tự.
- Form phát hành bằng chiều rộng thẻ vòng (tối đa 1180px), các trường và nút cùng hàng trên desktop. Dấu chú ý của admin chuyển từ Nộp bài sang Quản trị vòng. Thêm mũi tên quay về Các vòng luyện ở header.
- Điều khiển vòng hẹp hơn cấu hình, ba mốc giờ thành cụm gọn; thông báo rộng hơn và ô xuất kết quả thu nhỏ. Tăng quota khi vòng đang mở, giữ nguyên lượt đã dùng; không thay đổi thứ tự public/private.
- Chọn dịch vụ GPU trước khi chỉnh template. Các nhóm tài nguyên, lưu trữ/runtime và token dễ nhận diện. Mỗi chế độ có template/bản nháp riêng; Jupyter không hiện các trường token. Server từ chối template không khớp chế độ đã gắn.

## Bằng chứng kiểm tra

- `npm run typecheck`, `npm test`: 47 kiểm thử.
- `scripts/qa-admin-refinements.ts`: HTTP thật + Redis thật, namespace QA riêng. Đã kiểm tra email mới/tài khoản cũ, admin-only, năm yêu cầu quota trùng đồng thời chỉ cộng một lần, hai yêu cầu khác nhau không mất cập nhật, giữ counters/mốc thời gian, tăng private và từ chối stale/ended. Kiểm tra template sai dịch vụ dừng trước khi gọi Runpod.
- Bảo toàn `null` của mốc giờ trong JSON khi ghi quota. Kiểm tra thực tế phát hiện provider Lua cjson có thể bỏ các trường null khi encode lại toàn bản ghi; cập nhật chỉ thay trường hạn mức số nguyên trong JSON nguồn.
- `scripts/qa-admin-refinements-ui.js`: desktop 1600x1050 và mobile 390x844, 13 ảnh QA; xác minh typography/căn giữa, lý do lỗi bị ẩn, số điểm/nút lớn, bố cục admin, tăng quota qua UI thật, đổi/lưu ba chế độ template và giữ bản nháp.
- Phần giao diện kết quả nộp và provider GPU dùng response giả lập; auth, đăng ký và quota được kiểm tra bằng backend thật trong namespace QA. Không cấp Pod, không gọi model, không sửa vòng hay credential production, không đổi image GPU.
- Ảnh ở `output/playwright/admin-refinements-*`. Các fixture và phiên đăng nhập QA được dọn sau kiểm tra.
