# Bộ đề 02

Đầu vào: `../statements/Arena_02/`. Ngày chuẩn bị: 28/10/2026. Đây là bộ luyện mô phỏng do người dùng cung cấp, không phải đề chính thức.

Người dùng yêu cầu **chỉ nạp vào danh sách bộ đề quản trị**, tự phát hành vòng sau. Không tạo vòng production, không bắt đầu/đặt lại vòng, không cấp hoặc thay đổi Pod.

## Tài nguyên

Gói được chuẩn bị ở `../statements/Arena_02/web_ready/`:

| Tác vụ | Public ZIP | Private ZIP | PDF | Điểm tối đa |
| --- | --- | --- | --- | --- |
| 1 - Giao hàng | Tac_vu_1.zip | Tac_vu_1_private.zip | De_bai_1.pdf | 30 |
| 2 - Bình luận | Tac_vu_2.zip | Tac_vu_2_private.zip | De_bai_2.pdf | 35 |
| 3 - Máy bơm | Tac_vu_3.zip | Tac_vu_3_private.zip | De_bai_3.pdf | 35 |

Mỗi ZIP public chứa `Tac_vu_N/De_bai.pdf`, `Tac_vu_N/baseline.ipynb` và dữ liệu riêng. Không có mã lời giải, đáp án test hoặc mã sinh dữ liệu. Không phát toàn bộ thư mục `web_ready`: `handoff/judges` và `qa` là nội bộ.

GPU Workspace hiện có tự tải và giải nén public vào `/workspace/data/public/Tac_vu_N/`; private vào `/workspace/data/private/Tac_vu_N/data/private/` khi server mở giai đoạn. Notebook nhận diện cả cách bố trí này và cách giải nén thủ công vào cùng thư mục cha của các tác vụ. Không cần cập nhật image GPU.

## Điều chỉnh từ nguồn

- Giữ nguyên byte của các tệp train, drivers, restaurants; giữ từng hàng test, ID và tín hiệu. Nguồn chỉ có một tập test; chia cố định 50/50 thành hai tập không trùng ID bằng SHA-256 của ID. Bài máy bơm chia theo machine_id, mỗi tập ba máy và 1.050 cửa sổ.
- Public/private lần lượt: bài 1 là 2.500/2.500, bài 2 là 2.000/2.000, bài 3 là 1.050/1.050. Không dùng nhãn ẩn để chọn cách chia.
- PDF nguồn có phần ban tổ chức/lời giải; không phát PDF đó. Ba PDF mới chỉ chứa đề thí sinh và quy định Arena, tổng sáu trang.
- Metric, ngưỡng 3,79/2,60; 0,817/0,900; 0,273/0,930 và thang điểm 30/35/35 giữ từ `cham_diem.py`. Chưa hiệu chỉnh S_base/S_ref sau khi chia test. Điểm tối đa 100; kết quả dưới baseline được 0.
- Bản nguồn ghi 5 giờ, 5 lần nộp, lấy bản cuối. Bản Arena theo cấu hình thời gian/quota của vòng và lấy điểm tốt nhất mỗi giai đoạn, trả điểm ngay. Vòng mới mặc định theo web là 5 giờ public + 1 giờ private và 20/5 lượt mỗi tác vụ; admin được cấu hình trước khi bắt đầu.
- Theo quy định dự án, không phát gợi ý huấn luyện/thích nghi/chuẩn hóa theo cả tập test của nguồn. Có thể học từ 3.700 cửa sổ train không nhãn ở bài 3. Quy định này được ghi rõ trong đề mới.
- Ba notebook tự chứa mã baseline học máy từ nguồn, có EDA và validation tự chia. Mặc định không huấn luyện: dùng thống kê train để tạo CSV kiểm tra luồng. Đây không phải mô hình dùng để đặt S_base. Nhánh học máy cần bật RUN_TRAIN và USE_TRAINED; không có trọng số fine-tune phát sẵn.

## Thay đổi web

Tác vụ, schema CSV, điểm tối đa, tổng điểm và cột BXH lấy từ metadata của bộ đề. Bộ đề cũ không có judgeSpecs vẫn dùng Instance AP / SQuAD F1 như trước. API từ chối tác vụ không thuộc gói trước khi tải bộ chấm. Các khóa đáp án chỉ server đọc, không đưa vào asset cho thí sinh hoặc manifest Jupyter.

`src/lib/judge-arena02.ts` triển khai ba metric nguồn, chuẩn hóa và làm tròn như Python. CSV phải đủ ID, không trùng/lạ; nhãn đúng miền giá trị; dự đoán phân vị hữu hạn. Không thêm quy tắc loại p50 > p90 vì metric nguồn không có quy tắc này.

## Kiểm tra

- `npm run typecheck`, 44 kiểm thử, `npm run build`.
- Chạy ba notebook trên cả public/private với kết nối mạng bị chặn, RUN_TRAIN=False, USE_TRAINED=False; cả sáu lượt sinh CSV hợp lệ. **Không thực thi nhánh huấn luyện hoặc benchmark GPU**; các cell huấn luyện chỉ được kiểm tra cú pháp AST.
- Đối chiếu 12 bộ dự đoán Python/TypeScript: sáu CSV notebook mặc định và sáu CSV QA tạo từ nhãn nội bộ để kiểm tra điểm nằm giữa 0 và tối đa. Metric khớp với sai số dưới 1e-12, điểm chuẩn hóa khớp.
- Kiểm tra từng hàng test và từng cửa sổ NPZ so với nguồn, train giữ nguyên byte; public/private không trùng ID/máy. CRC ZIP và SHA-256 theo upload-plan.
- Render và kiểm tra trực quan đủ sáu trang PDF.
- HTTP thật trong namespace `arena:qa:arena02:<UUID>`: login, quyền đăng ký, ba đề, private gate, PDF download, chấm cả ba tác vụ, nonce trùng, bài lỗi không trừ quota, BXH tác vụ 3, chuyển private.
- Playwright desktop 1440x1000 và mobile 390x844: trang đề, tài nguyên, nộp bài tác vụ 3 thành công /35, tổng 100 và cột BXH thứ ba. Không cấp GPU. Bảng rộng cuộn ngang trong vùng bảng trên mobile.

## Nạp và vận hành

Đầu vào chính thức: `web_ready/handoff/package-config.json`; kế hoạch upload: `upload-plan.json` cùng thư mục. Tải đúng 15 đối tượng vào private Blob bằng `scripts/upload-package.ts`, kiểm tra hash và không ghi đè version khác. Dùng `scripts/stage-package.ts` để đưa vào danh sách quản trị. Import không tự phát hành vòng.

Admin vào **Vòng luyện → Phát hành vòng luyện**, chọn **Bộ đề 02**, đặt tên, phát hành rồi cấu hình thời gian/quota trước khi bắt đầu. Đề và dữ liệu tiếp tục chịu khóa theo đăng ký và giai đoạn.
