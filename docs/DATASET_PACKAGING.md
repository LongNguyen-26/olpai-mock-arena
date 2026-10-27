# Đóng gói bộ đề

Chuẩn sử dụng từ 28/10/2026, theo yêu cầu của người dùng. Tài liệu chuẩn hóa đặt dưới `statements/Arena_NN/web_ready/release_YYYYMMDD/`; giữ nguyên nguồn và bản phát hành cũ.

- Mỗi tác vụ có một ZIP public riêng, một ZIP private riêng và đề PDF tải riêng. Không gộp đề, JSON, ghi chú triển khai, README hoặc helper Python rời vào ZIP contestant. Chỉ phát notebook, dữ liệu, CSV và checkpoint/từ vựng cần thiết được phép.
- Jupyter mở ở `/workspace`, chứa `Tac_vu_1/`, `Tac_vu_2/`… Mỗi thư mục có `baseline.ipynb`, `dataset/train`, `dataset/public_test`; private được ghép vào `dataset/private_test` khi vòng cho phép. Không tạo trước `data/` và `Final/` trống.
- Baseline đơn giản, tự chứa mã, không EDA, không Markdown nhắc nhở/chú ý hoặc lời giải thích triển khai. Không chạy training để kiểm tra đóng gói. Kiểm tra chạy từ đầu sinh CSV đúng schema/ID trên public và private ở thư mục QA riêng.
- Đề tập trung vào bài toán, dữ liệu, đầu ra, metric và quy định. Không đưa câu phân loại nguồn như “dữ liệu mô phỏng do người dùng cung cấp”, “không phải đề chính thức”, lịch sử xử lý hoặc log như “không thay đổi train hoặc tạo dữ liệu mới” vào đề. Ghi chú kỹ thuật đặt ngoài đề/ZIP, trong `internal/`.
- Giữ nguyên dữ liệu, phân chia, nhãn, checkpoint và công thức chấm. Đổi JSON dữ liệu sang CSV phải tái dựng được nguyên văn và đúng kiểu/thứ tự. Số lượng trong đề phải đối chiếu tệp thật. Giữ ghi công và giấy phép trong tài liệu tải riêng.
- Lưu SHA-256 trong upload-plan/package config, dùng version mới bất biến và storage riêng tư. Chỉ nạp catalogue quản trị; quản trị viên tự phát hành vòng. Bản mới không thay package binding của vòng cũ hoặc tệp trên Pod đang dùng.

Các bản đầu tiên: `arena-01-clean-20261028-6e8204355b0e` và `arena-02-clean-20261028-8e996817b145`. Ghi chú chuyển đổi, kiểm tra và nguồn nằm tại `release_20261028/internal/` của từng bộ đề.

Theo xác nhận của người dùng, hai mục phiên bản cũ được gỡ khỏi danh sách chọn trên web sau khi nạp bản chuẩn hóa. Chỉ xóa entry trong catalogue; object package, storage, nguồn local và binding của vòng đã phát hành được giữ nguyên. Form phát hành có nhãn “Bản chuẩn hóa” để phân biệt phiên bản khi cần.
