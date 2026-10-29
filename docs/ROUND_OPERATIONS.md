# Vận hành nhiều vòng luyện

## Thí sinh

1. Đăng ký tài khoản cá nhân bằng email và đăng nhập. Tài khoản cũ tiếp tục dùng tên đăng nhập hiện có; không tự đổi định danh hoặc mật khẩu cũ.
2. Danh sách Vòng luyện hiển thị các vòng đã được quản trị viên phát hành, kể cả chưa bắt đầu.
3. Bấm Đăng ký tham gia. Mặc định được duyệt ngay; nếu vòng dùng duyệt thủ công thì chờ admin duyệt.
4. Bấm Vào vòng luyện. Đề và dữ liệu vẫn khóa cho đến thời điểm mở. Chưa đăng ký/đang chờ duyệt không đọc được tài nguyên qua API dù biết URL.
5. Tạo hoặc tham gia đội để nộp bài. Đăng ký vòng luyện áp dụng từng tài khoản; quota và kết quả áp dụng theo đội đã nộp. Thành viên được đổi trong lúc thi.

## Chấm điểm

Public và private đều trả điểm ngay khi nộp hợp lệ. Mỗi tác vụ lấy điểm cao nhất của từng bộ kiểm thử. Tổng là tổng hai tác vụ, tối đa 200 điểm. Nếu bằng tổng, ưu tiên EM tác vụ 2, rồi thời điểm đạt điểm sớm hơn. Không còn chọn bản private cuối để tính điểm.

Private chưa mở: không phát input/link Drive và chưa hiển thị BXH private cho thí sinh. Khi mở private: mặc định khóa nhận public và thu hồi chatbot; admin có thể đổi hai lựa chọn trước khi chuyển. Hết giờ khóa tất cả bài nộp, trừ khi admin mở chế độ luyện tập tiếp.

## Quản trị

- Hỗ trợ nhiều tài khoản quản trị. Khóa Redis `admin` giữ admin ban đầu; set `admins` chứa các admin bổ sung. Quyền được tra lại từ Redis theo mỗi yêu cầu, không nhận quyền admin từ form đăng ký hoặc cookie do client tự khai báo. Các admin không tính vào số thí sinh/quota/BXH; nộp thử vẫn được đánh dấu riêng.
- Cấp tài khoản bổ sung bằng script vận hành, ví dụ `npx tsx --env-file=.env scripts/create-admin.ts arena_admin_2 "Quản trị Arena 2" .local/ADMIN_2_ACCESS.local.md --production`. Script chỉ tạo tài khoản mới, không thay mật khẩu/tài khoản đang tồn tại; mật khẩu ngẫu nhiên lưu trong file local ignored, không in ra terminal. Không commit hoặc chia sẻ công khai file này. Người dùng đổi mật khẩu trong **Tài khoản** sau khi đăng nhập.
- Credential Runpod và quyền điều khiển Pod theo owner hiện có; thêm admin không tự sao chép credential hoặc đổi chủ Pod.

- Trên mỗi thẻ vòng ở **Các vòng luyện**, admin có nút **Bắt đầu** (khi chưa mở/đã hẹn giờ) và **Ẩn vòng / Hiện vòng**. Các nút thao tác không kích hoạt link vào vòng ở nền thẻ.
- Vòng ẩn vẫn hiện với nhãn **Đã ẩn** cho admin. Thí sinh không thấy trong danh sách và không truy cập được đề, dữ liệu, đăng ký, nộp bài hoặc Workspace của vòng qua web, kể cả biết link trực tiếp. Hiện lại giữ đăng ký, kết quả và lịch cũ; ẩn không đặt lại thời gian hoặc xóa Pod/tệp. Agent không cấp dữ liệu hay bật LLM cho vòng ẩn. Quyền được kiểm tra ở server; một bản nộp đang xử lý cũng bị chặn ở bước ghi Redis nếu vòng vừa ẩn.
- Vòng xóa khỏi web có `deletedAt`, được gỡ khỏi index và trả 404 cho cả admin/thí sinh. Bản ghi, kết quả và package nguồn được giữ để có thể khôi phục; lịch sử GPU vẫn đọc được ở admin với quyền truy cập dịch vụ tắt.
- Header hiển thị tên vòng và tên trang ở cạnh nút quay về danh sách; link vòng đã ẩn/xóa tự quay về danh sách để tránh giữ trang cũ.

- Bắt đầu ngay hoặc hẹn giờ Việt Nam (UTC+7).
- Chuyển sang private ngay: hộp thoại cho chọn khóa nộp public/thu hồi chatbot và sửa giờ kết thúc. Mặc định giữ giờ kết thúc hiện tại, không tính lại thời lượng private từ lúc chuyển sớm. Vòng vô thời hạn tiếp tục không có hạn kết thúc.
- Mở vô thời hạn: public giữ mở đến khi admin mở private; private giữ mở đến khi admin kết thúc.
- Đặt lại / mở lượt mới: hộp thoại có **Giữ BXH và bài nộp hiện tại**, mặc định bật. Bật giữ nguyên run, kết quả, lịch sử và quota đã dùng; bỏ chọn tạo run mới với BXH/quota đã dùng trống, dữ liệu lượt cũ vẫn lưu riêng. Cả hai lựa chọn đưa lịch về chưa mở, giữ đăng ký, bộ đề, Pod và tệp. Sau đó có thể bắt đầu thi hoặc mở luyện tập ngay.
- Có thể duyệt hoặc thu hồi quyền tham gia từng người. Đổi chế độ tự duyệt chỉ áp dụng cho đăng ký mới; đăng ký đang chờ vẫn cần admin xử lý.
- Khi public hoặc private đang mở, **Tăng quota cho tất cả đội** cộng thêm 1–100 lượt cho mỗi tác vụ của bộ kiểm thử đã chọn. Tổng hạn mức tối đa 1.000. Các đội giữ số lượt đã dùng; lượt tăng áp dụng cả đội mới tham gia sau đó. Yêu cầu cùng ID chỉ cộng một lần, yêu cầu độc lập đồng thời không làm mất phần tăng của nhau, yêu cầu từ lượt luyện cũ bị từ chối.
- Tăng quota không đổi lịch hoặc mở lại bộ kiểm thử đang khóa; sử dụng được cả trong chế độ luyện tập tiếp.

## Điều chỉnh lịch và quyền khi đang chạy

**Điều chỉnh thời gian** không đổi run ID, giờ bắt đầu thực tế, bài nộp, quota, Pod hay kernel. Trong public có thể dời mốc private về tương lai hoặc để trống để chuyển thủ công; trong private chỉ sửa hạn kết thúc. Để trống hạn kết thúc để mở vô thời hạn. Các trường giờ dùng UTC+7 và có phần xem trước; mốc đã lưu giữ chính xác cả giây. Muốn vào private ngay dùng nút chuyển giai đoạn để xác nhận các quyền.

**Khi private bắt đầu** lưu hai lựa chọn khóa public và thu hồi chatbot, mặc định bật. Lịch tự động áp dụng chúng bằng thời gian server, không cần trang admin mở. Chuyển giai đoạn được ghi nhận nguyên tử đúng một lần; private đã bắt đầu không thể dời ngược về public. Sau đó quản lý quyền bằng bảng **Quyền hiện tại của thí sinh**.

- Public/private submission có hai công tắc riêng: **Hiện** và **Nhận bài nộp**. Ẩn chặn API nộp nhưng giữ lựa chọn nhận bài; hiện lại khôi phục lựa chọn đó. Lịch sử, BXH và dữ liệu đã mở vẫn xem được. Private chưa tới giờ vẫn không nhận bài dù cấu hình đã bật.
- Ẩn/hiện private không đổi giai đoạn hay chạy lại quy tắc thu hồi chatbot/khóa public. Trong private có thể mở lại nhận public và cấp lại chatbot độc lập.
- **Cấp / hẹn giờ** cho phép dùng chatbot trong thời gian vòng đang mở, kèm giờ thu hồi tùy chọn. Không hẹn giờ nghĩa là dùng đến khi vòng/luyện tập kết thúc hoặc admin thu hồi. Đổi quyền vẫn giữ ngân sách và lịch sử chat; công việc trước lần thu hồi không thể phát câu trả lời sau khi được cấp lại.
- JupyterLab chỉ có công tắc mở từ website, không có bộ hẹn giờ riêng. Khóa quyền hoặc hết giờ không ngắt tab Lab đã mở, kernel, training hay Pod. Cấp quyền không tự cấp tài nguyên mới.
- Form sửa lịch/cấp quyền gắn với run và phiên bản lúc mở. Khi admin khác cập nhật hoặc private tự bắt đầu, form cũ bị từ chối để tránh ghi đè; đóng và mở lại form. Request trùng chỉ áp dụng một lần.

## Luyện tập trực tiếp và sau thi

Khi chưa bắt đầu, đang hẹn giờ hoặc đã kết thúc, bấm **Mở luyện tập tiếp**. Có thể dùng ngay sau thao tác đặt lại mà không cần bắt đầu/kết thúc một vòng thi trung gian. Nếu đã hẹn giờ thi, hộp thoại báo trước và xác nhận luyện tập sẽ hủy lịch thi đó. Chế độ `practice` dùng một hạn chung hoặc không giới hạn; không có lịch chuyển public → private. Cả hai split mặc định cùng nhận bài, hiện/ẩn riêng. Chatbot mặc định tắt; JupyterLab mặc định được phép mở nếu đã có Workspace phù hợp. Có thể cấp chatbot cùng giờ thu hồi riêng; quy tắc thu hồi khi vào private không áp dụng trong chế độ này.

Lượt luyện dùng nguyên run ID, đăng ký, bài nộp, BXH và số lượt đã dùng. Điểm mới tiếp tục ảnh hưởng BXH cũ; quota đã hết cần tăng bằng chức năng hiện có. Hết hạn hoặc **Kết thúc luyện tập** khóa nhận bài, chatbot và mở Lab từ web, giữ Pod/tệp/tiến trình. Mở luyện tiếp lần nữa vẫn tích lũy trên lượt này. Chỉ đặt lại với lựa chọn **không giữ BXH** mới tạo run mới.

API quản trị vẫn dùng `/api/admin/control`. Các action mới: `timing`, `private-policy`, `submission-access`, `chatbot-access`, `notebook-access`, `practice-open`, `practice-close`, `reset-round`; `open-private` nay yêu cầu hai lựa chọn và `endAt`. Chúng gửi `runId`, `revision` và UUID `requestId`; `reset-round` yêu cầu boolean `keepLeaderboard`. Reset ghi trạng thái lượt trước nguyên tử cùng cập nhật vòng và chặn request trùng/form cũ. API cũ `reset`/`new` tiếp tục hỗ trợ, mặc định tạo lượt trống nếu không truyền `keepLeaderboard`. Trường thời gian là Unix milliseconds hoặc `null`; quyền tiếp tục được kiểm tra ở server và trong Redis Lua trước khi ghi bài/phát phản hồi. Bản ghi cũ tự dùng mặc định tương thích, không cần migration production.

QA không cấp GPU: `node --env-file=.env --import tsx scripts/qa-round-controls.ts` kiểm tra Redis thật trong namespace mới và tự dọn. Thêm `--keep` để tạo `.local/round-access-qa.json`; chạy `scripts/serve-round-access-qa.ts` để mở cổng 3016, rồi Playwright CLI `run-code --filename scripts/qa-round-access-ui.js`. Sau khi đăng xuất/đóng browser và dừng server QA, chạy `scripts/cleanup-round-access-qa.ts` để dọn fixture. Fixture dùng đề giả nội bộ, không sao chép hay ghi vào vòng production.

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

CSV được lưu vào Blob private trước khi ghi nhận bài nộp. Khi Blob từ chối ghi (ví dụ bucket vượt storage miễn phí và chuyển read-only), web lưu bản gzip/base64 vào khóa Redis riêng `submission-file:<id>` cùng namespace, không nhét CSV vào hash lịch sử. Bản nộp vẫn chấm và tải lại qua API kiểm tra quyền; quota/idempotency áp dụng như thường. Tệp của yêu cầu bị trùng hoặc bị từ chối quota được dọn. Tệp cũ trong Blob tiếp tục tải bằng đường dẫn cũ. Kho dự phòng tiêu thụ dung lượng Redis; cần theo dõi dung lượng và khôi phục khả năng ghi Blob khi có điều kiện, không tự bật gói trả phí.

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
