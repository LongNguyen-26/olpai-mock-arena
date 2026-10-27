# Vận hành nhiều vòng luyện

## Thí sinh

1. Đăng ký tài khoản cá nhân bằng email và đăng nhập. Tài khoản cũ tiếp tục dùng tên đăng nhập hiện có; không tự đổi định danh hoặc mật khẩu cũ.
2. Danh sách Vòng luyện hiển thị các vòng đã được quản trị viên phát hành, kể cả chưa bắt đầu.
3. Bấm Đăng ký tham gia. Mặc định được duyệt ngay; nếu vòng dùng duyệt thủ công thì chờ admin duyệt.
4. Bấm Vào vòng luyện. Đề và dữ liệu vẫn khóa cho đến thời điểm mở. Chưa đăng ký/đang chờ duyệt không đọc được tài nguyên qua API dù biết URL.
5. Tạo hoặc tham gia đội để nộp bài. Đăng ký vòng luyện áp dụng từng tài khoản; quota và kết quả áp dụng theo đội đã nộp. Thành viên được đổi trong lúc thi.

## Chấm điểm

Public và private đều trả điểm ngay khi nộp hợp lệ. Mỗi tác vụ lấy điểm cao nhất của từng bộ kiểm thử. Tổng là tổng hai tác vụ, tối đa 200 điểm. Nếu bằng tổng, ưu tiên EM tác vụ 2, rồi thời điểm đạt điểm sớm hơn. Không còn chọn bản private cuối để tính điểm.

Private chưa mở: không phát input/link Drive và chưa hiển thị BXH private cho thí sinh. Khi mở private: đóng nhận public, mở nhận private và BXH private trực tiếp. Hết giờ: khóa tất cả bài nộp.

## Quản trị

- Trên mỗi thẻ vòng ở **Các vòng luyện**, admin có nút **Bắt đầu** (khi chưa mở/đã hẹn giờ) và **Ẩn vòng / Hiện vòng**. Các nút thao tác không kích hoạt link vào vòng ở nền thẻ.
- Vòng ẩn vẫn hiện với nhãn **Đã ẩn** cho admin. Thí sinh không thấy trong danh sách và không truy cập được đề, dữ liệu, đăng ký, nộp bài hoặc Workspace của vòng qua web, kể cả biết link trực tiếp. Hiện lại giữ đăng ký, kết quả và lịch cũ; ẩn không đặt lại thời gian hoặc xóa Pod/tệp. Agent không cấp dữ liệu hay bật LLM cho vòng ẩn. Quyền được kiểm tra ở server; một bản nộp đang xử lý cũng bị chặn ở bước ghi Redis nếu vòng vừa ẩn.
- Vòng xóa khỏi web có `deletedAt`, được gỡ khỏi index và trả 404 cho cả admin/thí sinh. Bản ghi, kết quả và package nguồn được giữ để có thể khôi phục; lịch sử GPU vẫn đọc được ở admin với quyền truy cập dịch vụ tắt.
- Header hiển thị tên vòng và tên trang ở cạnh nút quay về danh sách; link vòng đã ẩn/xóa tự quay về danh sách để tránh giữ trang cũ.

- Bắt đầu ngay hoặc hẹn giờ Việt Nam (UTC+7).
- Mở private sớm: chuyển sang nhận private ngay; trong vòng có thời hạn, private kéo dài đúng số phút đã cấu hình tính từ lúc mở sớm.
- Mở vô thời hạn: public giữ mở đến khi admin mở private; private giữ mở đến khi admin kết thúc.
- Đặt lại / mở lượt mới: trở về chưa mở, quota và BXH lượt mới trống. Đăng ký và bộ đề giữ nguyên. Lượt cũ vẫn lưu ở các khóa Redis theo run ID.
- Có thể duyệt hoặc thu hồi quyền tham gia từng người. Đổi chế độ tự duyệt chỉ áp dụng cho đăng ký mới; đăng ký đang chờ vẫn cần admin xử lý.
- Khi public hoặc private đang mở, **Tăng quota cho tất cả đội** cộng thêm 1–100 lượt cho mỗi tác vụ của bộ kiểm thử đã chọn. Tổng hạn mức tối đa 1.000. Các đội giữ số lượt đã dùng; lượt tăng áp dụng cả đội mới tham gia sau đó. Yêu cầu cùng ID chỉ cộng một lần, yêu cầu độc lập đồng thời không làm mất phần tăng của nhau, yêu cầu từ lượt luyện cũ bị từ chối.
- Luồng giai đoạn giữ nguyên: mở private thì đóng public. Tăng quota không đổi mốc giờ hoặc mở lại bộ kiểm thử đã khóa.

## Nạp bộ đề tiếp theo

Hai tác vụ hiện có là **Bộ đề 01**. Bộ khác được bổ sung sau khi người dùng/Astra cung cấp nội dung. Nạp bộ đề không tự tạo vòng hiển thị cho thí sinh.

`npm run import:contest -- /path/to/statements "Bộ đề 02"` vẫn hỗ trợ cấu trúc dữ liệu hiện tại và chỉ đưa bộ đề vào danh sách admin. Cấu trúc ZIP/baseline mới đang chờ Astra chuẩn hóa theo [ASTRA_CHUAN_HOA.md](ASTRA_CHUAN_HOA.md).

Với gói đã chuẩn bị và upload vào Blob private, dùng:

```sh
npx tsx --env-file=.env scripts/stage-package.ts .local/package-config.json
```

Manifest cần version mới, title, tasks (ID 1, 2 và tùy chọn 3; title/content Markdown riêng), assets (key/name/bytes/sha256/phase/description, tùy chọn task và driveUrl), judges (public/private cho từng tác vụ). Các object phải tồn tại trong Blob private; version không được trùng. Bộ đề 01 tiếp tục dùng Instance AP và SQuAD F1. Bộ đề 02 bổ sung judgeSpecs, schema CSV và điểm tối đa 30/35/35 cho ba tác vụ; xem [ARENA_02.md](ARENA_02.md). Gói dùng metric mới phải có bộ chấm tương ứng trước khi phát hành.

Admin mở Vòng luyện → Phát hành vòng luyện → chọn bộ đề → nhập tên → Xác nhận phát hành. Khi xác nhận, vòng mới mới xuất hiện cho mọi người đăng ký, nhưng đề/dữ liệu chưa mở.

## Drive và ZIP hiện tại

Giữ nguyên ZIP/dữ liệu theo quyết định của người dùng; chưa gộp train/validation hoặc bỏ JSON/module Python. Hai bản trên Drive là cùng tệp ZIP với tải trực tiếp trên web, đã đối chiếu tên và số byte. PDF tổng/Markdown không còn là tài nguyên tải riêng trên web, nhưng nội dung cũ bên trong ZIP đang chờ Astra chuẩn hóa.

Cả public/private trên Drive đều được chia sẻ bất kỳ ai có link theo lựa chọn của người dùng. Website chỉ cấp link private khi mở private. Không đưa các URL này vào mã nguồn Git; lưu chúng trong metadata bộ đề ở Redis. Cập nhật từ file local ignored bằng `scripts/update-drive-links.ts`.

## CSV kiểm tra riêng cho admin

Thư mục `.local/test-submissions/` có public/private, mỗi tác vụ 4 CSV: nộp thử, lỗi định dạng, hợp lệ điểm thấp, hợp lệ điểm cao. Xem điểm đo trong `KET_QUA_KIEM_TRA.json`. File điểm cao được tạo từ đáp án để kiểm tra hệ thống, **không phải kết quả mô hình**, không phát cho thí sinh.

## Kiểm tra và triển khai

```sh
npm run typecheck
npm test
npm run build
```

QA dùng namespace `arena:qa:*` riêng. `qa-setup.ts`, `qa-rounds-flow.ts`, `qa-cleanup.ts` tạo/kiểm tra/dọn đúng namespace đó. Không cung cấp credential production cho preview chưa duyệt. Hiện kiểm tra đầy đủ qua local QA nên chưa cần Redis preview bổ sung.

Nâng cấp từ bản một vòng: chạy `scripts/migrate-rounds.ts` một lần. Script giữ nguyên tài khoản, bộ đề và các lượt nộp hiện có; không tự mở đề hoặc phát hành thêm bộ giả. Nếu cần đặt lại đồng hồ sau nâng cấp, dùng admin Đặt lại / mở lượt mới.


## Nộp thử và gói chuẩn hóa

Admin nộp thử được với cả public/private khi vòng chưa bắt đầu hoặc đã kết thúc; không cần đội, không có quota và không xuất hiện trên BXH. Bài CSV không hợp lệ vẫn có trong lịch sử với lý do lỗi; chỉ bài hợp lệ của đội được tính quota.

Dùng `scripts/upload-ready-package.ts` với thư mục `web_ready` để xác minh checksum và tải đúng các tệp trong upload-plan. Script chỉ chuẩn bị manifest trong `.local`, không phát hành vòng. `scripts/stage-package.ts` thêm gói vào danh sách cho admin xác nhận. Link Drive chỉ cập nhật sau khi tải xong đúng phiên bản, không trỏ gói mới sang ZIP cũ.

`scripts/refresh-round-package.ts` dành cho chuyển một vòng đã kết thúc sang gói mới và xóa kết quả thử khi người dùng yêu cầu rõ ràng. Chạy trước không `--apply` để xem phạm vi; sau đó dùng `--apply`. Script giữ tài khoản, đội, đăng ký và đưa vòng về trạng thái chờ.
