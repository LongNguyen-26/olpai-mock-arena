# Bàn giao chuẩn hóa bộ đề 01 cho Astra

Cập nhật 27/10/2026: đã nhận gói `statements/Arena_01/web_ready`, tải dữ liệu/PDF/bộ chấm theo manifest và đối chiếu đủ bốn điểm baseline qua API. Các yêu cầu bên dưới được giữ làm lịch sử và tiêu chí cho bộ đề tiếp theo.

Theo yêu cầu người dùng ngày 27/10/2026. Hai tác vụ hiện tại thuộc **một bộ đề**. Bản web mới sử dụng bộ dữ liệu chuẩn hóa đã bàn giao. Không sửa thư mục statements gốc ở lượt triển khai web này.

## Sản phẩm cần bàn giao

- Mỗi tác vụ có một PDF riêng, không phát PDF tổng. Nội dung gồm yêu cầu, dữ liệu, schema, metric, model/tài nguyên được phép và cách nộp; bỏ phần “Nguồn tham khảo và phạm vi suy luận” và các đoạn giải thích về quá trình biên soạn.
- Giữ tên “Bộ đề 01”, “Tác vụ 1”, “Tác vụ 2”; không đưa mã phiên bản nội bộ vào nội dung thí sinh đọc.
- Chỉ phát baseline dạng `.ipynb`. Notebook phải tự chứa hoặc được phép kèm đủ mã cần thiết để chạy offline và sinh CSV đúng schema. Cần quyết định cách xử lý các module Python đang được notebook/entrypoint import, không xóa máy móc làm baseline hỏng.
- Gộp phần train và validation vào một thư mục cho thí sinh tự chia validation. Cập nhật statement, notebook, metric validation, đường dẫn và các phát biểu về số mẫu. Giữ nguyên holdout public/private và nhãn chấm.
- Không xóa JSON nếu nó đang là dữ liệu cốt lõi. Tác vụ QA dùng questions.json/labels.json; CV dùng manifest.json. Nếu đổi sang CSV/JSONL hoặc cấu trúc khác, cần sửa baseline và schema tài liệu đồng bộ, kiểm tra đầy đủ ID/context/answer offsets/mask dimensions.
- Bỏ README, Markdown và các tệp giải thích/nguồn không dành cho thí sinh trong ZIP; trong mỗi tác vụ chỉ có tài liệu PDF của tác vụ đó. Giấy phép/ghi công bắt buộc cần được giữ theo hình thức thích hợp (ví dụ phụ lục PDF), không làm mất nghĩa vụ giấy phép SQuAD CC BY-SA.
- Public ZIP gồm đề PDF từng tác vụ, train có nhãn, public input không nhãn, notebook và model gốc được phép. Private ZIP chỉ gồm đầu vào private cần thiết. Không có organizer, raw, nhãn test, gợi ý từ nhãn, kết quả kiểm thử hay checkpoint đã fine-tune trái luật.

## Quy định website đã đổi theo yêu cầu

- Điểm private và BXH hiển thị ngay khi private được mở.
- Public và private đều lấy **điểm cao nhất từng tác vụ**. Không còn chọn một bản private cuối để tính điểm.
- Tổng điểm là **tổng hai tác vụ**, tối đa 200, không lấy trung bình.
- Admin có thể mở private sớm, mở vòng vô thời hạn, kết thúc và mở lại lượt luyện. Thời gian/quota được cấu hình theo từng vòng.

Statement mới cần thống nhất các quy định này. Không giữ đoạn “private chỉ phản hồi hợp lệ”, “chọn một bản cuối” hoặc công thức chia 2 trong tài liệu mới.

## Kiểm tra trước khi thay thế

1. Chạy baseline offline và sinh CSV hợp lệ cho cả public/private (private do người coi thi kiểm tra).
2. Xác nhận không trùng/thiếu ID và không rò nhãn vào ZIP thí sinh.
3. Đối chiếu metric, schema, số lượng mẫu và model whitelist với statement mới; không tự đoán luật chính thức 2026.
4. Bàn giao ZIP public/private, PDF từng task, tên hiển thị, cấu hình bộ chấm và ghi chú thay đổi.
5. Người vận hành nạp bản mới vào mục bộ đề nháp; **admin xác nhận phát hành vòng** thì thí sinh mới nhìn thấy và đăng ký. Không tự phát hành bộ đề mới khi import.

Drive: người dùng chấp nhận cả public/private ZIP được chia sẻ “bất kỳ ai có liên kết”; website chỉ ẩn link private trước giờ mở. Giữ liên kết riêng từng tệp, không phát một thư mục public chung khiến private lộ ngay trong link public.
