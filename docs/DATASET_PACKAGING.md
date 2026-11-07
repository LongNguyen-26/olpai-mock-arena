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


## Trình bày trên web từ Regional 01 — 07/11/2026

- Trang đề có tab Hướng dẫn chung sau các tác vụ. Bộ đề mới có thể cung cấp `webPresentation: { version: 1, generalInstructions: "Markdown", attributions: "Markdown" }`; tài liệu tương ứng dùng asset kind `general-instructions` hoặc `attribution` khi đã có nội dung web. Tệp PDF tác vụ và PDF tổng hợp hai đề vẫn giữ trong danh sách tải. Ghi công/giấy phép được giữ trong mục mở rộng ở trang hướng dẫn khi bỏ tệp TXT riêng theo yêu cầu.
- Asset PDF dùng kind `statement`, ZIP dùng `archive`. Chỉ ZIP public được gắn `baselineNotebooks` với tên tệp thực tế. `upload-ready-package.ts` đối chiếu kích thước/SHA trước, đọc central directory của ZIP mà không giải nén/chạy notebook, rồi ghi metadata đã xác minh vào `.local/ready-package-config.json`. Nạp chính manifest đã chuẩn bị này bằng `stage-package.ts`; không bỏ qua bước quét bằng cách dùng lại handoff manifest chưa có metadata. Nếu ZIP không có baseline thì không hiển thị nhãn.
- Công thức viết bằng `$...$` hoặc `$$...$$`; trình đọc đề dùng remark-math/KaTeX và font nội bộ. Không đưa mã Python, đường dẫn hoặc CSV vào dấu toán học. Công thức dài cuộn trong vùng của nó trên màn hình nhỏ.
- Regional 01 được áp dụng bằng bản trình bày ghim theo version và SHA của các asset hiện có, giữ PDF tổng hợp `Bo_de_Regional_01.pdf`. Tác vụ 1 có hai notebook `baseline_subtask1.ipynb`/`baseline_subtask2.ipynb`, Tác vụ 2 có `baseline.ipynb`; không đổi tên hoặc tạo notebook mới chỉ để gắn nhãn.
- Vòng mang tên Mô phỏng thi 03 hiện gắn Bộ đề Arena 04: hướng dẫn riêng và ghi công chuyển vào web, các PDF tác vụ giữ nguyên. Những bộ cũ khác giữ cách tải trước đây. Các bản trình bày này không ghi đè cấu hình package bất biến, dữ liệu, checkpoint, bộ chấm hoặc package binding của vòng.
