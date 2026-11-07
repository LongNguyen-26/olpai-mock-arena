# Thẻ tác vụ nổi bật trên danh sách vòng luyện — 05/11/2026

- Điều chỉnh thu gọn sau phản hồi: tên 15px trên desktop rộng, 14px ở độ rộng dưới 1400px; padding 11–12px, nhãn 10px. Playwright đo hai tên Arena 04 đầy đủ trên một dòng ở 1280/1600px, chiều cao ô 70–73px; kiểm tra thêm 1024/820/768/390px không tràn/cắt chữ. Trên màn hình hẹp cho phép xuống dòng, mobile xếp dọc với chữ 16px. 100 unit test và production build kèm TypeScript qua; ảnh `output/playwright/round-task-compact-*.png` dùng fixture component thật.
- Application commit `0367c34a747080337ca41b54b9944b7d6c554b2b`; Render deploy `dep-dbm5nirm8hqs73eqgp40` live và health khớp full SHA. Smoke trên `https://olpaiarena.cyou` qua: catalogue/nhãn/tên tác vụ và CSS production có ô tác vụ cùng grid hai cột. Chỉ đọc dữ liệu, không đổi vòng thật.
- Hai tác vụ đặt cạnh nhau thành hai ô nền xanh nhạt, nhãn số riêng, tên đậm 18px (17px ở tablet); màn hình dưới 560px xếp dọc để giữ chữ lớn. Vòng ba tác vụ dùng ba cột trên desktop, hai cột ở tablet và một cột trên điện thoại. Giữ đầy đủ tên, không cắt bằng ellipsis.
- Typecheck, 100 unit test và production build qua. Playwright kiểm tra component RoundCard/CSS thật với dữ liệu giả ở 1600/1280/1024/820/768/390px: cùng hàng khi đủ rộng, không tràn ngang/cắt chữ, không page error. Đã xem ảnh desktop/tablet/mobile trong `output/playwright/round-task-tiles-*.png`. Đây là QA bố cục bằng component render, không giả lập thành kết quả kiểm tra API/backend; không sửa dữ liệu hay tạo GPU.

# Quản lý vòng luyện và tên phiên bản bộ đề — 05/11/2026

- Application commit `2018e2286ca1a3439ed5fd209d48de4aafd4acb1`; Render deploy `dep-dbm4f2ou01pc738cc9d0` live, full SHA khớp health trên `https://olpaiarena.cyou`. Smoke catalogue qua: 6 vòng, 5 gói đã nạp với nhãn Arena/phiên bản đúng, đủ tên tác vụ và bộ đề nguồn. Smoke hồi quy qua login/đề 6 vòng/239 bài nộp hiển thị/98 Workspace/roster; logout dọn session. Không sửa/xóa/sắp xếp vòng thật để smoke, không gọi provider GPU. Log ứng dụng sau deploy trong khoảng kiểm tra không có error/warning. Manual Deploy đúng một lần sau khi xác nhận push không tạo deploy tự động.
- Admin sắp xếp lên/xuống, đổi tên ở mọi giai đoạn, xóa sau hộp xác nhận; API kiểm tra quyền và dữ liệu phiên bản cũ. Xóa mềm giữ bài nộp/đăng ký/bộ đề, không thao tác Pod. Catalogue tính nhãn Arena/bản cũ/bản hiện hành/lịch sử chuẩn hóa từ metadata; giữ package ID bất biến và binding vòng. Thẻ hiện tác vụ sau khi mở, có bộ đề nguồn riêng cho admin.
- Typecheck, 100 unit test và production build local qua. Windows sandbox chặn junction của Turbopack; build với quyền tạo junction qua, không bỏ kiểm tra TypeScript.
- Supabase và Redis thật trong namespace QA riêng: rename đồng thời chỉ một lần thành công, reorder kiểm tra thứ tự cũ, xóa trả 404 và giữ package/đăng ký. Nhánh Redis cũ qua reorder CAS/rename đồng thời/xóa mềm. Không seed/import/migration production, không gọi nhà cung cấp GPU.
- Playwright trên local dùng API/Supabase/Redis thật: đăng nhập admin/thí sinh, reorder giữ sau reload, rename từ thẻ và khi đang thi, Hủy không gửi delete, xác nhận xóa trả 404 cho cả hai vai trò; thí sinh gọi cả ba action quản trị trả 403. Không page error; 403/404 trong các kiểm tra quyền là dự kiến. Đã xem ảnh desktop/mobile và hộp xác nhận, không tràn ngang. Browser đã đăng xuất/đóng; server, namespace và credential QA đã dọn. Ảnh trong `output/playwright/round-catalogue-*.png` chỉ là fixture QA.

# Chuyển dữ liệu chính sang Supabase trên Render — 05/11/2026

- Application commit `29613f3c3211eb8a2b05adbb2d35afa813012be1`; Render SQL deployment `dep-dbm3m1l9fdbs73boop1g` live. Health cả `olpaiarena.cyou` và `olpai-arena.onrender.com` trả postgres/migration 1/đúng SHA.
- Typecheck, 95 unit tests và production build qua. QA SQL/Redis thật trong namespace riêng qua 12 nhóm kiểm tra: tranh chấp username/team/quota/reservation, task 3/invalid/idempotency, reset run, SQL authority, queue/budget, cache eviction, replay sau SQL rollback, Hub ticket và callback đến muộn. Runpod/Pod được giả lập trong QA, không tạo GPU tính phí.
- Rehearsal và production import đều khớp toàn bộ row/checksum của 18 bảng: 46 users, 18 teams/36 members, 9 packages, 9 rounds, 17 runs, 102 registrations, 245 submissions, 53 quotas, 18 receipts, 14 templates, 2 ciphertext credentials, 2.966 runtime history. Namespace SQL production trước import trống; import dưới write-freeze, đã gỡ freeze sau smoke.
- Smoke HTTP staging và production qua: hash đăng nhập cũ, quyền admin, 6 vòng hiển thị và đề, 239 submissions trong run hiển thị, roster, 98 Workspace; logout dọn session. SQL smoke cả hai host Render qua. Smoke Render còn kiểm tra giải mã credential cũ bằng đọc giá Runpod, không cấp Pod. Không có Workspace đang hoạt động. Log Render sau deploy chưa có error/warn; Supabase security advisor không có lint. Size database khoảng 23 MB, không còn namespace QA/staging.
- Đã sửa tải lịch sử Workspace lớn làm cạn hàng đợi SQL pool bằng gom dữ liệu/gộp truy vấn trùng trong một response đọc; không cache policy giữa request. Backup AES-GCM, rehearsal restore SQL về Redis nghiệp vụ đã đối chiếu, giữ runtime hiện tại. Không chuyển Blob/Drive hoặc đổi encryption key.
- Vercel pause đến 30/11/2026, thêm env trả 402. Người dùng duyệt tiếp tục riêng Render và xử lý Vercel sau. Giữ auto deploy Vercel; trước khi dùng lại cần SQL env + code main hiện hành + smoke, không dùng Redis cũ làm nguồn mới. Xem [runbook](SUPABASE_DATABASE.md).

# Giao diện JupyterLab cho thí sinh và quyền quản trị — 30/10/2026

- Thí sinh mở JupyterLab từ thẻ GPU như Pod Jupyter thông thường. Không hiển thị bảng quản trị server/team; readiness xét đúng team, revision và heartbeat, cùng lịch truy cập của vòng. Server dừng/đang chuẩn bị/mất heartbeat/lỗi/khóa lịch đều có trạng thái ngắn gọn và không bật link sai.
- Chỉ admin sở hữu Pod được start/stop server qua service/API. Đường dẫn `/workspace/hub` cũ chỉ redirect tới launch, không POST khởi động; mở Lab không đổi desired state/revision. Chẩn đoán image pull/extract và lỗi provider được lược khỏi view/API thí sinh; admin vẫn giữ chi tiết gốc.
- Bảng đăng ký GPU tách Đang dùng/Đang chờ, thao tác theo trạng thái riêng: Xin lượt → Bắt đầu dùng hoặc Hủy → Trả lượt. Vẫn cho nhiều đội đang dùng và giữ thứ tự theo thời gian server; nhắc trả lượt không dừng kernel/job.
- [CI web 41008569742](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/41008569742) đạt typecheck, 83 test TypeScript và build. Local chạy tuần tự 83 test đạt; lần chạy song song trước đó hết bộ nhớ Windows, không tính là đạt. QA Hub với Redis trong namespace ngẫu nhiên đạt: start/stop cùng/khác team bị 403, mở Lab giữ revision, readiness đúng team, SSO replay, nhiều lượt GPU, manual và reset. Provider hoàn toàn giả lập, namespace tự dọn.
- Playwright dùng bản build CI và Redis QA riêng: admin thêm team/hộp xác nhận dừng; thí sinh có link Lab trên thẻ GPU, không có nút quản trị, POST start/stop trả 403; popup tới đích giả lập và bookmark cũ chỉ redirect; Xin/Bắt đầu/Trả/Hủy qua API thật của QA; các trạng thái stopped/starting/stale/error/locked và ẩn log Runpod đạt. Đã xem ảnh desktop/mobile, không tràn ngang: `output/playwright/hub-{admin,student}-{desktop,mobile}.png`. Không có page error; có request 401 trong lúc đăng xuất giữa hai vai trò. Không thao tác Pod thật hoặc thay image.

# Hub storage v2 khi volume root luôn `0777` — 30/10/2026

- Log `(20)` xác nhận `.arena uid=0 gid=0 mode=0o777` sau CREATE/chmod. Thay việc bảo vệ root control bằng mode trên volume: Hub dùng `/run/arena-hub/control` cục bộ `0700`, cookie/secret `0600`, DB SQLite cục bộ. Bản bền vững là checkpoint AES-GCM xác thực trên volume, ràng buộc workspace và agent credential; không chứa policy/URL pha cũ, không tự xoay key hoặc ghi đè checkpoint lỗi.
- Checkpoint mỗi 10 giây/khi dừng bình thường, DB được backup nhất quán. PID cũ bị bỏ sau restart; khôi phục Linux account tách khỏi chuẩn bị home để một home lỗi không chặn toàn Hub. UID được đối chiếu ownership/marker bền vững khi metadata gần nhất chưa kịp checkpoint. Home/venv/bài làm vẫn ở volume.
- UID volume riêng `62000` ngoài dải team. Private staging/cache `0700`; dataset được tải HTTPS/Drive/checksum/giải nén dưới UID dữ liệu với HOME riêng, recheck pha rồi publish `0755`/`0444`, hardlink khi cùng owner và dọn cache tải. Không truyền credential điều khiển cho worker hoặc notebook. Home rỗng được publish, khóa, kiểm tra không có tệp chèn và ghi marker trước khi cài venv/notebook; UID không giữ được mode riêng gây lỗi rõ, không bỏ kiểm tra để chạy.
- [CI 41004156324](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/41004156324) đạt typecheck, 82 test TypeScript, build, 28 test Python 3.10 và 14 test Linux. Các ca mới ép root volume `0777`/chown thất bại, kiểm tra local control riêng và checkpoint không chứa khóa rõ; khôi phục DB/UID/key sau mất local state, từ chối ciphertext bị sửa hoặc binding khác; giải nén qua FD khi bỏ DAC override của root; chặn tệp chèn trước activation; tải HTTPS thật với CA cục bộ, SHA/size đúng, chỉ một lần tải, publish chỉ đọc và dọn cache. Các ca kernel/RTC/quyền/khôi phục trước đó tiếp tục đạt.
- Image đã publish và đối chiếu registry/CI: `sha256:5691a3d185f474eec536a49417717c5a91a16011949024d18a9f5b342b129740`, mã runtime `d8695f7b99b102d84824b4b310b9fe3f65ba854d`. Không bật, restart hoặc thay image Pod của người dùng; bản này dành cho Pod/volume mới. Chưa xác nhận các UID không phải root và kernel/CUDA/WebSocket của image này trên host Runpod thật.

# Sửa cold-start tạo thư mục điều khiển — 30/10/2026

- Log `(19)` xác nhận startup dừng tại kiểm tra `.arena`, trước Hub/agent. Không có UID/mode trong log cũ; Web Terminal báo stopped nên chưa đo được owner/mode thực tế của Pod. Không xác nhận một nguyên nhân metadata cụ thể khi thiếu phép đo này.
- Sửa điểm tạo `.arena` đầu tiên trong `start.py` và agent thành `mkdir(mode=0700)`; thư mục Hub cũng được tạo riêng ngay từ đầu. Không tạo bằng mode mặc định rồi phụ thuộc chmod. Bỏ SETATTR/chown thừa khi metadata đúng; kiểm tra chín bit quyền truy cập thay vì từ chối cả setgid/sticky vô hại. Owner root và việc chặn group/other vẫn được giữ. Lỗi kiểm tra có basename, UID/GID/mode/errno, không có nội dung khóa hoặc env.
- [CI 40997124372](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40997124372) đạt typecheck, 82 test TypeScript, build, 28 test Python 3.10 và 10 test Linux. Ca mới đi qua bước chuẩn bị root của startup rồi `launch_plan` với Hub thật, mô phỏng chmod không đổi mode, kiểm tra mode CREATE đúng, chặn team khác, từ chối control hiện hữu `0755` và chấp nhận control riêng có setgid. Chín ca UID/NFS/cookie/kernel/RTC/khôi phục trước tiếp tục đạt.
- Không bật, restart hoặc thay image Pod hiện tại. Bản này được chuẩn bị cho Pod mới; kết quả CI không thay thế kiểm chứng trên host Runpod và chưa chứng minh UID/mode thực tế của volume đang lỗi.
- Image publish đã đối chiếu giữa Docker Hub/CI: `sha256:fd54427217f45123053c33ad8ea369af9eef1c2512d076dcc72db834b08b8df1`, mã runtime `0569a7ea698ccdda96a199577f70346e1bd1ccfd`.

# Sửa cookie secret khi Hub chạy trên NFS — 30/10/2026

- Log người dùng xác nhận image `5141126f…` tải xong nhưng Hub thoát với `cookie_secret_file can be read or written by anybody`; container lặp lại trước khi có Lab team. Không coi trạng thái này là lỗi trình duyệt hoặc chờ image.
- Giữ khóa gốc trên volume trong thư mục điều khiển root `0700`; tạo bản dùng lúc chạy trên filesystem cục bộ `/run/arena-hub/cookie-secret`, mode `0600`, cùng giá trị. JupyterHub vẫn thực thi kiểm tra quyền gốc. Secret mới tạo bằng mode `0600` ngay lúc tạo tệp, không theo symlink; thư mục sai quyền và khóa lưu bị hỏng gây lỗi rõ, không tự xoay hoặc in khóa.
- [CI 40994198052](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40994198052) đạt typecheck, 82 test TypeScript, build, 28 test Python 3.10 và 9 test Linux. Ca mới khởi động Hub với khóa volume mode `0666`, kiểm tra bản local `0600` giữ giá trị và chặn team đọc cả hai; khóa hỏng không bị tự tạo đè. Các ca UID/NFS/khôi phục/kernel/cộng tác tiếp tục đạt.
- Playwright trên production xác nhận lỗi authorize của Hub đã đóng trả HTML 409 có thông báo, không meta refresh, không tự điều hướng trong bảy giây và không pageerror. Đã xem ảnh `output/playwright/hub-nfs-error-page.png`, đăng xuất phiên QA, xóa auth state và đóng browser. HTTP 409 tạo console resource error đúng dự kiến; không quy thành lỗi JavaScript.
- Theo yêu cầu mới, không bật hay thay image Pod đang tắt. Chỉ chuẩn bị image/template cho Pod mới; chưa nghiệm thu SSO/kernel/WebSocket/CUDA của image cookie mới qua proxy Runpod thật.
- Image publish đã được đối chiếu Docker Hub/CI: `sha256:0ca70c5f5558e586f7ff232e912b58fcaeef7f68601fdeb68f17847fdd89c902`, từ mã runtime `e3acddc7a6c16858980fa9e53afd0a34ffc4ff87`.

# Sửa home team trên Runpod NFS và trang chờ đăng nhập — 30/10/2026

- Người dùng xác nhận `/workspace` dùng NFS4 trong container có UID remapping: root không chown được home (`EPERM`), trong khi `/tmp` chown được. Phép thử tạo tệp trực tiếp bằng UID team thành công, team khác bị chặn, root không đọc được home `0700` (`EACCES`). Đây là lỗi chuẩn bị home sau khi Hub đã chạy; khác lỗi import trước đó.
- Runtime tạo home dưới UID team qua FD staging kín, công bố bằng rename, rồi tạo thư mục/chép tệp/kiểm tra venv bằng UID đó. Kernel và starter nhận đúng FD nguồn đọc; không mở thư mục quản trị cho team hoặc nới quyền home. Chỉ tạo lại home root sở hữu còn trống do lần khởi tạo lỗi; giữ home sai chủ đã có tệp. Log chỉ ghi bước, loại lỗi và errno, không ghi exception string hoặc HTTP body.
- Trang authorize hiển thị lỗi hoặc trạng thái đã dừng thay vì refresh mãi. Chỉ tự kiểm tra trạng thái tạm thời trong tối đa ba phút; không tự dừng workspace khi hết thời gian chờ.
- [CI 40984307571](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40984307571) đạt typecheck, 82 test TypeScript, build, 28 test Python 3.10 và 8 test Linux. Ca mới mô phỏng chặn chown/root đọc home, kiểm tra chủ tệp thật, quyền giữa team, khởi tạo lại home rỗng và giữ home đã có tệp. Các ca Hub/kernel/RTC/khôi phục trước đó tiếp tục đạt. QA Hub và Workspace dùng Redis thật trong namespace riêng, provider giả lập, đã đạt và tự dọn; không thuê Pod.
- Image đã publish ở `sha256:5141126f199fe035a87f172821d14fb28bc7a2a89f9178b36ea265087f45fa95`, mã runtime `5feb69b6e96a2f385094ecc9bff81920f7c7ad2c`. Theo yêu cầu người dùng, dừng kế hoạch sửa/restart Pod hiện tại để người dùng terminate rồi tự cấp Pod mới. Chưa kiểm chứng image này qua SSO/kernel/WebSocket/CUDA trên Runpod thật; không quy kết quả Linux và phép thử filesystem thành nghiệm thu GPU.
- Kiểm thử Python cục bộ trên Windows/Python 3.10 lại treo và đã dừng đúng tiến trình của lần chạy này. Kết quả Python công bố ở trên là 28 ca đã đạt trên CI Linux, không phải lần chạy Windows đó.

# Sửa đường dẫn module khi JupyterHub khởi động — 30/10/2026

- Log Pod thật xác nhận Hub không import được `hub_auth` khi Traitlets đọc `hub_config.py`; container thoát trước khi khởi tạo JupyterLab. Cấu hình hiện thêm đường dẫn module root sở hữu `/opt/arena`, không phụ thuộc thư mục hiện hành hay biến môi trường kế thừa.
- [CI 40979376281](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40979376281) đạt typecheck, 80 test TypeScript, build, 28 test Python 3.10 và 7 test Linux. Test Linux bỏ `PYTHONPATH` và chạy Hub từ thư mục khác trong cả khởi động đầu và phục hồi; vẫn kiểm tra UID, quyền tệp, kernel và cộng tác hai trình duyệt.
- Image sửa đã publish ở `sha256:75434bdfad178c33e0b744582c125c7a33f31d5310ba89c7cf822f50058eaf30`, mã runtime `0c71cfcc68e15721ee4e9e6cd7e3cfcb599597e3`. Thay cho runtime `179b5581…` trong hướng dẫn cấp Pod mới. Kết quả CI không chứng minh CUDA hoặc kết nối qua proxy Runpod.

# Phân biệt tải/giải nén image khi Pod chưa chạy — 30/10/2026

- Thêm chẩn đoán không gây lỗi cho pull/extract từ System Logs; hiển thị trạng thái riêng trên thẻ Pod. Giữ phân loại GPU reset/container error, giới hạn SSE, cache và loại bỏ raw log/credential. Health hoặc telemetry thật xóa tiến trình cũ; chưa chạy container không mở Jupyter/Chatbot.
- Typecheck, 80 test TypeScript và build đạt. Redis QA namespace riêng xác nhận pulling/extracting giữ provisioning, chi phí/reservation và cùng Pod, cache chẩn đoán, lỗi host và phục hồi không cấp lại. Provider/model được giả lập; không thuê GPU để QA.
- Playwright `qa-pod-startup-ui.js` đạt với auth/Redis QA thật: lỗi host, trạng thái chờ chung/pull/extract, hồi phục, khóa truy cập khi chưa sẵn sàng, điều khiển an toàn, desktop/mobile; 0 pageerror, 0 control call. Đã xem ảnh `output/playwright/image-pull-{desktop,mobile}.png`, `image-extract-desktop.png`; đăng xuất/đóng browser và dọn đúng 78 key QA cùng fixture.
- Sự cố Pod thật nằm trước startup JupyterHub: runtime null, agent 404, system log chờ image. Xem [RUNPOD_TROUBLESHOOTING.md](RUNPOD_TROUBLESHOOTING.md). Không diễn đạt sửa web thành khôi phục được mạng/Docker daemon của host Runpod.

# JupyterHub: nhiều team trên một Pod — 30/10/2026

- Thêm chế độ Jupyter-only `team-hub`, workspace theo team, cấp quyền động, SSO ticket dùng một lần và bảng lượt GPU tự quản. Pod vật lý giữ một ledger; Chatbot và chế độ `single` cũ tiếp tục độc lập. Có luồng chuẩn bị/kiểm tra/gắn/gỡ Pod thủ công, xác minh tài khoản Runpod, image digest và runtime identity trước khi cấp manifest.
- Runtime dùng UID/GID thật, home `0700`, venv/kernel riêng và môi trường notebook không có credential điều khiển. Dataset checksum tải một lần, bản chung chỉ đọc, private theo manifest; ghi vào home không đi theo symlink. Dừng team giữ bài làm, thêm team không restart các server đang chạy. Kiểm tra RAM/đĩa trước spawn, không áp quota cứng hoặc cưỡng chế lượt GPU.
- Typecheck, 79 test TypeScript, build web và 28 test Python 3.10 đạt. [CI Linux](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40969488285) đạt 7 test: quyền UID/home/secret, dataset chỉ đọc/private/symlink, thêm team thứ tư giữ ba server cũ, Chromium hai phiên cộng tác/chạy kernel trong venv team và hồi quy file browser/kernel chế độ `single`; thiếu RAM/đĩa/telemetry, hết chỗ và lỗi chuẩn bị một team giữ nguyên các team khác; tạo lại tài khoản Linux/Hub sau dừng cưỡng bức vẫn giữ UID, notebook đã lưu và venv. Hai trình duyệt thấy cùng output, refresh giữ nội dung.
- `qa-hub-flow.ts` dùng Redis thật trong namespace QA riêng với Runpod giả lập: allocation/start đồng thời, grant/revoke, SSO nonce/replay, nhiều team đánh dấu dùng GPU, manual identity/bind/detach và reset cả giữ/đổi run. `qa-workspace-flow.ts` tiếp tục kiểm tra các luồng cũ; không cấp Pod thật.
- Playwright `qa-hub-ui.js` đã kiểm tra API/Redis QA thật, thêm team, bảng lượt, giao diện thí sinh/admin và desktop/mobile; ảnh ở `output/playwright/hub-*.png`. Đã đăng xuất/đóng trình duyệt và dọn fixture/namespace QA. Test Linux dùng SSO cục bộ giả lập và CPU; chưa chứng minh CUDA hay kernel/WebSocket qua proxy Runpod. Hai phần này nghiệm thu trên Pod do người dùng tự cấp.
- Image dependency đầy đủ đã publish ở `sha256:ddbc15474bd5fdb8d63e5d876db0910a638b11ca70bb6ce5c6bf3088b63b40d0`; runtime cuối ở `sha256:179b5581b07e2f4a3b51f27101bdc1bc3f71e6daedbe9f138b21ced172513951`, mã `fc97a34fe490a3a4972be7c1a8e0bd2c3804b8d6`. Xem [JUPYTERHUB.md](JUPYTERHUB.md) để cấp tự động/manual và nghiệm thu Pod đầu tiên. Tag `2026.10.27` cũ được giữ nguyên; template đã lưu và Pod đang dùng không bị tự thay image.

# Sửa lỗi cấp GPU HTTP 400 — 27/10/2026

- Nguyên nhân: payload gửi CUDA 13.1/13.2 ngoài enum REST v1 Runpod. Giới hạn lại 12.8/12.9/13.0 theo [schema chính thức](https://docs.runpod.io/api-reference/pods/POST/pods), thêm hồi quy cho payload và thông báo validation chỉ dùng tên trường an toàn.
- 23 kiểm tra TypeScript và build production đạt. Credential admin đã lưu trả HTTP 200 khi list Pod; đối soát yêu cầu BKDN.AVENGERS không có Pod tương ứng. Không in key hay tạo Pod kiểm tra tính phí.

# GPU Workspace — 27/10/2026

- Chốt theo người dùng: A40 48 GB, DeepSeek 32B Q4_K_M, môi trường luyện tập cho phép Internet/pip; registry `nguyenlong26/olpai-workspace`. Bổ sung nguồn OLP chính thức về 2.000 token chung input/output mỗi session năm 2025, không áp thành luật 2026.
- 22 kiểm tra TypeScript và 7 kiểm tra runtime Python CPU/ASGI/ZIP đạt: quyền, giới hạn token, khóa private và dừng model để trả VRAM. Không quy thành kiểm thử GPU.
- Script `qa-workspace-flow.ts` đạt trên Redis thật trong namespace QA mới, Runpod/Pod HTTP giả lập: mã hóa credential, cấp đồng thời chỉ gọi create một lần, quyền đội, private manifest, token/idempotency, reset run, stop/start/terminate và phục hồi mất xác nhận. Không tạo Pod thật.
- Script `qa-workspace-http.ts` đạt qua bản production build tại localhost:3010 với dữ liệu QA: phiên đăng nhập, 401/403, Origin, DTO không secret, redirect Jupyter, khóa chatbot private.
- Giao diện admin desktop/mobile và chatbot đã được mở và xem ảnh; nút Chatbot tạo tab mới, `/usage` hiển thị ngân sách. Ảnh QA trong `output/playwright`, không chứa Runpod key thật.
- Build image local đã dừng do ổ C hết dung lượng/lỗi I/O; chưa push image từ máy local. Theo yêu cầu chuyển sang workflow GitHub Actions, pin SHA các action, kiểm tra web/Python trước build/push, cần `DOCKERHUB_TOKEN` trong repository secret. Không tự tạo GPU trả phí để nghiệm thu.
- [CI build/push thành công](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40476925267), commit `4efd5d143422c8c16f6b2b9145ed0d23255b8ac0`. Image public Linux/amd64: `nguyenlong26/olpai-workspace@sha256:22f21a6b87f728d87f9dedd68028985b7a10be0b451a843f52be751682bea817`; đã ghim digest trong cấu hình production.
- Đã cấu hình ba biến GPU Workspace trên Vercel production, khóa mã hóa dưới dạng Secret theo xác nhận của người dùng; bản sao local nằm ngoài Git. Script `smoke-gpu-production.ts` kiểm tra API sau phát hành mà không cấp Pod hay đổi vòng thi.
- Còn cần một lượt chạy A40 thực tế để kết luận CUDA, model, hai kernel và chia sẻ VRAM hoạt động; chưa tạo Pod tính phí.

# Kiểm tra gói chuẩn hóa và luồng nộp bài — 27/10/2026

- 13 kiểm tra đơn vị đạt: thời gian, phân quyền, schema CSV/RLE, metric, điểm cao nhất và loại bài lỗi/admin khỏi BXH.
- 12 nhóm kiểm tra HTTP tích hợp đạt trên Redis/Blob thật trong namespace QA riêng: tài khoản, đội, đăng ký/duyệt, khóa đề/dữ liệu, quota/idempotency, public/private, vòng vô thời hạn và reset độc lập.
- Bài CSV lỗi trả 422 kèm ID lịch sử, không tăng quota; lỗi hạ tầng không được ghi thành bài CSV lỗi. Bài nộp thử admin được nhận trước/sau giờ thi, không cần đội, không tính quota hoặc BXH. API đội từ chối admin.
- Kiểm tra giao diện qua trình duyệt: vào vòng giữ nguyên khung trang; sidebar không có đội cho admin; spinner khi chấm; kết quả thành công/lỗi; chuyển mục rồi quay lại sẽ có form mới.
- Đã tải 8 đối tượng của `arena-01-standardized-20261027-79ef062c077b` sau khi xác minh kích thước và SHA-256 với upload-plan. Dữ liệu và tài liệu lấy nguyên từ `statements/Arena_01/web_ready`; không chạy lại training.
- Bốn CSV baseline từ handoff được nộp qua API chấm thật và khớp báo cáo chuẩn hóa với sai số dưới 1e-9: CV public 43.21789632788748, private 39.95419176131378; QA public 48.90975121788441, private 50.59815643719256. Các giá trị là kết quả CSV kiểm tra bàn giao, không phải điểm thi của đội.
- File gold chỉ được dùng trong QA tách biệt. Không đưa nhãn chấm hoặc CSV QA lên Drive hay Git.
- Người dùng yêu cầu xóa 3 bài thử cũ và chuyển vòng hiện tại sang gói mới, chờ admin bắt đầu. Script kiểm tra chính xác run ID và object prefix trước khi xóa; giữ tài khoản, đội và đăng ký.
- Chưa benchmark tải đồng thời lớn; ứng dụng phục vụ luyện nhóm nhỏ.

# Kiểm tra bản nhiều vòng luyện — 27/10/2026

- TypeScript và Next.js production build: đạt.
- 12 kiểm tra đơn vị: mốc thời gian, vòng vô thời hạn, mở private sớm, tổng điểm, điểm cao nhất, schema CSV/RLE, metric và tách/sạch nội dung từng tác vụ: đạt.
- 11 nhóm kiểm tra tích hợp qua HTTP với Redis và Blob thật trong namespace arena:qa:rounds2: đạt. Gồm đăng ký cá nhân, catalogue không lộ tài nguyên, tự duyệt, duyệt thủ công, thu hồi quyền, đề khóa trước giờ, chấm CSV thật, quota/idempotency chung theo đội, mở private sớm và BXH trực tiếp, tổng 200 điểm, vòng vô thời hạn và đặt lại vòng không làm lẫn điểm/quota vòng khác.
- CV và QA grader giữ nguyên định nghĩa metric đã đối chiếu Python ở bản đầu; không train mô hình.
- CSV public thử: CV baseline 43.21789632788748, điểm thấp 0, điểm cao 100; QA baseline 48.759952210945315, điểm thấp 5.912596401028278, điểm cao 100. File cao được tạo từ gold chỉ để kiểm tra ứng dụng, không phải model score.
- ZIP gốc không được thay đổi. Train/validation, JSON và baseline đóng gói chờ Astra theo quyết định người dùng.
- Drive: tải public 359652506 byte và private 9500906 byte; xác nhận chia sẻ Viewer / bất kỳ ai có liên kết. URL chỉ lưu trong metadata Redis, không commit vào Git.
- Giao diện đăng nhập, danh sách vòng và quản trị được xem trong trình duyệt. Không benchmark tải đồng thời lớn; ứng dụng phục vụ luyện nhóm nhỏ.
# Sửa cấp GPU thực tế — 27/10/2026

- Chuyển quản lý Pod sang GraphQL với cùng mutation như Python SDK GraphQL; truyền cấu hình qua variables, chỉ lấy id/name/status/rate. Giữ catalog giá REST v2.
- Kiểm tra trực tiếp: A40 Community trả `SUPPLY_CONSTRAINT` trong HTTP 200 và không tạo Pod. Đã cấp đúng một A40 Secure cho BKDN.AVENGERS, Pod `0fb95yqf1t0bka`, Runpod xác nhận RUNNING và $0,59/h. Chưa kết luận dịch vụ trong container/model sẵn sàng chỉ từ desiredStatus.
- Dùng CUDA tối thiểu 12.8 thay enum REST v1 cố định; catalog thực tế báo host CUDA 13.2. Mặc định và template đã lưu dùng Secure.
- Sửa ước tính chi phí khi chưa nhận Pod ID về $0, kể cả dữ liệu cũ; không tự gửi lại khi mất xác nhận. Giữ thông báo hết tài nguyên khi đối soát yêu cầu bị từ chối.
- Typecheck và 26 unit tests đạt. Script tích hợp Redis thật, Runpod giả lập đạt: cấp đồng thời, mất xác nhận, SUPPLY_CONSTRAINT, hủy yêu cầu lỗi, stop/start/terminate, quyền đội, private và token.

# Kiểm chứng Jupyter, reset vòng và DeepSeek — 27/10/2026

- Sửa Workspace tự gắn run ID mới của cùng vòng; giữ Pod và tách chat/token theo run. Nút dùng cùng điều kiện pha, đăng ký và service readiness như backend. Tab chat tự đồng bộ khi model sẵn sàng, không phụ thuộc dashboard đang mở.
- Model worker theo dõi policy liên tục: khởi động lại khi public mở, trả VRAM khi private/đóng; chặn phản hồi của run cũ sau reset.
- 27 unit tests, 9 Python tests, typecheck và Redis QA đạt. CI Ubuntu/Python 3.10 xác nhận web production build và runtime tests.
- [CI image cuối thành công](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40508452681). Digest runtime: `sha256:f3ce6656c68b37f3d574c6b0f7f95243a4eef4de75363c22f2a07e020fd2bba5`. Cập nhật Pod cũ `0fb95yqf1t0bka`, kiểm tra không có kernel trước mỗi lần restart; volume `/workspace` 100 GB giữ nguyên, cache GGUF 19.851.335.840 byte còn đủ.
- Kiểm chứng trên Pod thật: `/api/status` không token trả 200; `/api/contents` và `/api/kernels` không token trả 403; status có token giữ schema Jupyter chuẩn. Mở Notebook theo quyền thí sinh sau reset trả 200.
- DeepSeek thực sự lên A40 (~19,2 GiB VRAM); token-count và generate qua agent trả 8 token. Không chạy notebook training hay chấm dữ liệu thi.
- Chrome/Playwright xác nhận uptime tăng từng giây và Chatbot bị vô hiệu khi model chưa sẵn sàng. Uptime lấy từ telemetry, không tính từ thời điểm gửi yêu cầu cấp phát.
- Kiểm tra browser tìm thêm lỗi Host nội bộ của proxy làm Jupyter chặn WebSocket. Cấu hình `allow_origin` đúng domain của từng Pod và `trust_xheaders`; không bật wildcard hoặc tắt xác thực. Browser đã render đầy đủ Lab và chạy `1 + 1` qua kernel WebSocket, trả `2`; kernel QA được xóa sau kiểm tra.

# Pod chung và tách dịch vụ — 27/10/2026

- 29 unit tests, 13 Python tests và typecheck đạt. Redis QA dùng namespace riêng/Runpod giả lập kiểm tra: một private Pod cũ cùng hai shared Pods, cấp đồng thời không trùng, đội tạo sau, chặn người chưa có đội, legacy reservation, tách lịch sử/token theo đội và chặn route dịch vụ không bật.
- [Image tách dịch vụ build/push thành công](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40514595000). Mặc định/template cho Pod mới ghim digest `sha256:b6ca1acfecc2ed190280679ca2d29f82fd541bc1224d4d399abf976086f6ebcb`. Production kiểm chứng Pod hiện có vẫn cùng ID/image cũ, scope team/services both; không restart hoặc tạo GPU mới trong kiểm thử tính năng.
- Chrome/Playwright desktop 1440 và mobile 390 px: chọn scope all/Jupyter-only, giữ lựa chọn dataset, xác minh payload teamId null và đúng round/services; nhóm shared/private cùng hiện; LLM-only không có link Notebook và ngược lại. Mobile không tràn ngang. POST cấp Pod trong UI QA được chặn và trả dữ liệu ví dụ, không gửi tới Runpod.
- API production chặn cấu hình scope team thiếu teamId bằng 400 trước cấp phát. Default image mới, DTO legacy và trường nội bộ/secret đã được kiểm tra. Hướng dẫn lỗi Runpod được lưu riêng và liên kết trong AGENTS.md.

# Chat riêng theo máy/tab — 28/10/2026

- Mở Chatbot lần đầu tạo UUID và lưu vào `sessionStorage` theo Pod; refresh giữ UUID. “Đoạn chat mới”/`/new` đổi UUID, xóa lịch sử hiển thị và bản nháp; ID mặc định cũ bằng Pod ID được thay bằng UUID.
- Ba unit tests mới đạt; typecheck và bộ test hiện có đạt. Playwright kiểm tra hai tab cùng browser, browser context riêng, refresh, chat mới, `/new`, lịch sử và tab còn lại trên localhost và production. API chat giả lập, không gọi model hay tạo Pod. Script tái sử dụng: `scripts/qa-chat-sessions.js`.
- Production SHA `2d85f21d59634c23d1ee8925e76bfe95fa53012e`, deployment `dpl_EQbanhaPxHRMAQDWjeYXJj4Qey3M` đã `READY`; smoke login/API/config thật đạt. Không đổi Docker image, Redis schema hoặc Pod đang chạy. Hướng dẫn build/deploy/QA và các lưu ý vận hành đã bổ sung trong `AGENTS.md`.

## GPU layout và gói task-root — 28/10/2026

- Typecheck, 49 kiểm thử TypeScript, production build và 15 kiểm thử runtime Python CPU đều qua.
- `qa-workspace-flow.ts`: Redis namespace riêng, Runpod/agent giả lập; kiểm tra không nạp dataset trả assets rỗng, vẫn giữ quyền/lịch và chuyển metadata task-root. Không tạo GPU thật.
- `qa-gpu-layout-ui.js`: Edge desktop 1600px/mobile 390px, login QA thật, provider giả lập. Kiểm tra telemetry Pod cũ có nhãn/đơn vị, trạng thái thu gọn mở được, thông báo cạnh Làm mới, bỏ tổng chi phí rời và payload không nạp dataset; không tràn ngang, không có pageerror.
- Bản chuẩn hóa dưới `statements/Arena_01|02/web_ready/release_20261028`: 5 notebook đã chạy public/private trên CPU, không training; CSV đủ ID/schema, dữ liệu/bộ chấm/weights đối chiếu nguồn, PDF được render kiểm tra. Nguồn cũ giữ nguyên, bản mới chỉ nạp catalogue quản trị, không tự phát hành vòng.
- `check-standardized-baselines.ts`: cả 10 CSV được bộ chấm web hiện tại chấp nhận, mỗi tệp dưới 3 MB. Đây là kiểm tra pipeline/schema và nhãn chấm, không khẳng định chất lượng mô hình hoặc benchmark GPU.
- CI runtime [40574925727](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40574925727) build/push thành công; digest `sha256:4510a9e0bfbb96ca83873df7535d61367b594d841387557b561df4ab5a5a94cf` đã ghim trên env production và template tương lai. Danh tính, image và vòng gắn trên record Pod hiện tại không đổi.

## Quản lý hiển thị và bố cục vòng — 28/10/2026

- Typecheck, 49 kiểm thử TypeScript và production build đạt. Runtime Python/image không thay đổi.
- `qa-round-visibility.ts`: HTTP/Redis thật trong namespace QA riêng, kiểm tra admin-only, boolean validation, danh sách và link tài nguyên ẩn trả 404, đăng ký bị chặn, bản nộp đang xử lý bị chặn trước khi trừ quota, hiện lại giữ đăng ký; vòng đã xóa trả 404 với cả admin.
- `qa-workspace-flow.ts`: Runpod giả lập, kiểm tra Workspace vòng ẩn không hiện cho thí sinh, agent inactive, lịch sử Pod của vòng đã xóa vẫn đọc được cho admin. Không tạo hoặc điều khiển GPU thật.
- `qa-round-management-ui.js`: desktop 1600px/mobile 390px; tên vòng trên header, link quay về rõ hơn, ô datetime và nút Hẹn giờ thẳng hàng, timestamp UTC+7 đúng, ẩn/hiện/bắt đầu nhanh trên thẻ, nhãn vòng đang xem. Bố cục quản trị gồm điều khiển ngang, cấu hình, thông báo, kết quả và danh sách đăng ký; kiểm tra không tràn ngang.
- Xóa khỏi web đúng hai vòng dùng package cũ: `a544c419-8b06-4e1f-ac6e-e56444075003` (Bộ đề 01 cũ) và `eb708a8f-5cbd-4c9a-bf27-b7e062786b78` (Bộ đề 02 cũ), theo yêu cầu người dùng. Script vận hành xác minh package binding, không còn Pod đang cấp, dùng CAS cho cả hai vòng; không đổi vòng dùng package chuẩn hóa hoặc xóa source package, đăng ký/kết quả/Pod.

## Nhiều tài khoản quản trị — 28/10/2026

- Typecheck, 49 kiểm thử TypeScript và production build đạt. Admin gốc giữ khóa cũ; các tài khoản bổ sung dùng set `admins`.
- `qa-multiple-admins.ts`: namespace QA riêng, dùng chính script provisioning để tạo tài khoản, kiểm tra thử lại không ghi đè mật khẩu; HTTP xác nhận cả hai admin đăng nhập và điều khiển vòng, user thường bị từ chối, admin bổ sung nộp thử không trừ quota/không vào BXH, các admin không bị tính là thí sinh và thu hồi quyền có hiệu lực ngay trên phiên đang đăng nhập.
- Không thay đổi password/session của admin hiện có, cấu hình vòng hoặc owner/credential GPU khi thêm tài khoản. Mật khẩu mới chỉ được lưu trong file local ignored; không in log hoặc đưa vào Git.

## Nộp bài và hiển thị chatbot — 28/10/2026

- Nguyên nhân nộp bài: Blob trả `AccessDenied`; dịch vụ ký upload xác nhận bucket bị read-only vì vượt storage miễn phí. Không đổi gói hay xóa tài nguyên. Khi Blob từ chối ghi, CSV gzip/base64 được lưu vào khóa Redis riêng; API tải vẫn kiểm tra quyền đội/admin và không lộ khóa lưu trữ trong snapshot.
- Typecheck, 51 unit tests và production build đạt. `qa-submission-storage.ts`: HTTP/Redis/Blob thật, namespace QA riêng, cả sáu cặp tác vụ/split chấm đúng; CSV tải lại nguyên vẹn, Unicode filename đúng; bài sai schema giữ lịch sử và không trừ quota; hai POST đồng thời cùng nonce nhận cùng ID và chỉ tính một lượt; yêu cầu trùng/bị từ chối quota không để tệp Redis thừa; đội khác không tải được CSV.
- `qa-workspace-flow.ts`: Redis thật, Runpod/model giả lập, kiểm tra input vượt 1800 và thiếu ngân sách phiên vẫn lưu tin nhắn, dùng hết ngân sách và chặn gọi model tiếp; retry cùng request không tính lại; phiên mới độc lập, số token provider sai không bị coi là vượt giới hạn. Không cấp hay điều khiển GPU thật.
- Playwright Edge desktop/mobile: `qa-chat-sessions.js` giữ tách tab/máy, refresh, `/new`; `qa-chat-rendering.js` kiểm tra KaTeX cho các dấu phân cách, code không bị sửa, clipboard đúng (chuẩn hóa CRLF của Windows khi so sánh), tin nhắn vượt input không trả về composer, khóa phiên qua reload, `/usage` và `/new` vẫn hoạt động. Provider chat giả lập. KaTeX cảnh báo thiếu metric ký tự tiếng Việt nhưng công thức đã được kiểm tra trực quan, không có pageerror.
- `qa-submission-ui.js`: nộp CSV qua UI/API thật trong namespace QA, hiển thị điểm 19,92 và lịch sử trên desktop/mobile, không tràn ngang; logout sau kiểm tra. Ảnh ở `output/playwright/chat-*.png` và `submission-fixed-*.png`, chỉ phục vụ QA.

## Token, template và quyền xem metrics — 29/10/2026

- Typecheck, 56 kiểm thử TypeScript và production build đạt. Không đổi Python runtime hay image. Token có `session` (input/output cộng dồn riêng) và `turn` (giới hạn mỗi lượt); thiếu trường mode giữ cách tính cũ. Footer và log `/limits` cập nhật theo cấu hình mới; cấp Pod mới dùng context theo input + output, Pod cũ không tự restart.
- `qa-workspace-flow.ts`: Redis thật trong namespace riêng, Runpod/model giả lập; kiểm tra hai ngân sách riêng, phiên per-turn vượt tổng cũ vẫn gửi được, lượt quá dài được lưu nhưng không đưa vào prompt kế tiếp, phiên per-session hết input thì khóa; template của hai admin độc lập, tên trùng khi lưu đồng thời chỉ nhận một cấu hình; metrics bị bỏ khỏi DTO state/sync của thí sinh nhưng admin vẫn xem được.
- `qa-workspace-settings-http.ts`: HTTP/Redis thật với fixture QA; kiểm tra admin-only/boolean/running-only cho toggle, xác nhận/revision/tên chuẩn hóa khi lưu template, API chat đọc policy mới của template đang gắn Pod, state và sync không rò telemetry ẩn. Không gọi model/Pod thật.
- `qa-workspace-settings-ui.js`: Playwright Edge desktop 1600px/mobile 390px, đăng nhập và lưu template/metrics qua API thật trong namespace QA; metadata GPU/model giả lập. Đạt các luồng Cấu hình mới, tên trùng, ghi đè cần xác nhận, hủy không lưu, RAM/vCPU thay theo GPU, response cũ không ghi đè GPU mới, refresh giữ bản nháp và tự nhận bản mới khi chưa chỉnh, nạp lại bản đã lưu, footer và `/limits` cập nhật cả hai chế độ ở tab khác, ẩn/hiện metrics theo vai trò. Không tràn ngang hoặc pageerror; logout và dọn cookie sau kiểm tra. QA chat nhiều tab/máy và `/new` tiếp tục đạt.
- Truy vấn metadata Runpod thật đã kiểm chứng `gpuTypes.lowestPrice.minMemory/minVcpu` cho 1 GPU; A40 Secure trả 50 GB/9 vCPU tại thời điểm kiểm tra, A5000 Secure không có offer nên UI không đoán thông số. Đây là dữ liệu offer tại thời điểm đọc, không xác nhận stock hay tài nguyên Pod đã cấp.
- Theo yêu cầu, kho template riêng Admin 1 (`arena_admin`) được khôi phục A40/Secure, RAM tối thiểu 48 GB, 8 vCPU, disk 30 GB, volume 100 GB, tổng legacy 2000/input 1800/output 1024; giữ image digest đang dùng cho Pod mới. Catalogue cũ giữ nguyên A5000 để Admin 2 kế thừa, không đổi Pod. Bản trước thao tác và kết quả nằm trong `.local/primary-template-restore-20261029.json`.



## Hàng đợi, nhóm Pod và template chung — 29/10/2026

- Thay thế chính sách template/token của mục trước: mọi admin dùng cùng catalogue; tổng input + output phiên luôn bị giới hạn ở cả hai mode. Script reset có dry-run, snapshot Redis + file local, ID preset mới và phục hồi; đã kiểm tra trong namespace QA.
- Typecheck và 56 unit test TypeScript đạt; 21 Python CPU test đạt trên Python 3.10/FastAPI 0.115.11/httpx 0.28.1. Production build đạt. ASGI test/build cần chạy ngoài sandbox Windows do sandbox gây treo/EPERM; không có GPU/model thật trong các kiểm tra này.
- Giữ các ca provider/quyền/vòng đời trong `qa-workspace-flow.ts`, cập nhật phần chat sang protocol worker và template chung; bộ này đã đạt với Redis thật/Runpod và model giả lập. `qa-chat-queue.ts` kiểm tra burst 28 prompt, claim/cấp phát đồng thời, chia lượt theo đội, cap liên dịch vụ, lease/uncertain, callback lặp/muộn, drain, reset/private/thu hồi thành viên, outage và phục hồi session cũ. Không cấp GPU tính phí.
- HTTP QA xác minh 202/idempotency/xung đột nội dung, group/worker auth, Origin, cách ly đội và khóa private. Fixture thiếu runtime thật bị giữ ở readiness gate; redirect chỉ hợp lệ khi đủ readiness.
- Playwright Edge desktop/mobile: prompt hiện ngay, không có nhãn tiến trình, animation suy luận hoặc nút hủy; giữ draft khi đang có request, khóa gửi/new, refresh không trùng prompt, outbox retry cùng ID, tách tab và browser. Admin 1/2 thấy và sửa cùng template, trần tổng hiện ở cả hai mode, payload thêm Pod có groupId/allocation UUID. Provider/model giả lập; không tràn ngang hoặc pageerror; đăng xuất sau QA.
- Ảnh QA ở `output/playwright/chat-queue-*.png`, `chat-admin-*.png`. `benchmark-chat-queue.ts` chuẩn bị tải 14/28 request trên nhóm do admin cấp, mặc định dry-run; chưa đo throughput GPU thật.

## Chẩn đoán Pod lỗi host GPU — 29/10/2026

- Log người dùng xác nhận image tải đủ nhưng host lỗi `GPU requires reset` 14 lần khi tạo container. Đối soát thật: Pod đã bị thu hồi, REST 404 và danh sách Runpod rỗng; nhóm còn tồn tại, vòng chưa bắt đầu. Không cấp thêm GPU tính phí để thử.
- Typecheck, 59 unit test và production build đạt. Unit test mới kiểm tra SSE chia chunk, log lỗi có secret chỉ trả mã, log không được cấp quyền/đang tải bình thường không bị xem là lỗi, giới hạn stream và hủy reader.
- `qa-workspace-flow.ts`: Redis thật trong namespace riêng, Runpod/model giả lập; kiểm tra desired RUNNING nhưng chưa có container, lỗi GPU reset, cache log 60 giây, giữ phí và reservation, không tạo trùng, phục hồi cùng Pod. Các kiểm tra vòng đời/quyền/token cũ vẫn đạt. `qa-chat-queue.ts` đạt lại, gồm burst 28 request và phục hồi/lease/cutoff/template.
- Playwright Edge desktop/mobile qua `qa-pod-startup-ui.js`: nhãn lỗi, thao tác dừng/thu hồi còn dùng được cho Pod xác nhận, Admin tự đối soát cả Pod lỗi, nhãn khởi động và trạng thái sau phục hồi. Không tràn ngang hoặc pageerror trong luồng thử; ảnh `output/playwright/pod-startup-{desktop,mobile}.png`. Provider và health được giả lập; chưa xác nhận GPU/inference thật sau sự cố.
- Đối soát bổ sung khi người dùng đã cấp Pod thay thế `4jux2bn1xqpprz` trong cùng nhóm: agent `/health` thật trả 200, CUDA telemetry nhận A40 và queue protocol 1. Vòng vẫn chưa bắt đầu public nên model bị khóa theo policy (`llm=false`); chưa chạy inference. Thẻ Worker nay hiện `modelStage` để phân biệt khóa theo lịch và lỗi khởi động. Không restart hoặc đổi policy của Pod này.

## Thiết kế nhóm GPU và dịch vụ đơn — 29/10/2026

- Khung Chatbot chứa ô mở Chatbot, tổng quan Admin, bộ chọn GPU nằm ngang và toàn bộ thanh Pod thành viên. Mỗi Pod giữ metrics VRAM/utilization/nhiệt độ/uptime/chi phí, lỗi, đối soát và thao tác riêng; bỏ ô Worker Chatbot trùng chức năng. Nút thêm Pod nạp đúng nhóm vào form hiện có, chỉ cấp khi quản trị viên chủ động gửi form.
- Phần điều phối nằm riêng, dùng Pod ID thật, kết nối/heartbeat tới giây, tương thích giao thức/run và thao tác ngừng/tiếp tục giao việc. Nhóm giữ thao tác pause/resume, đối soát các Pod và đóng nhóm khi rỗng.
- Thí sinh dùng nhãn Chatbot, không có thống kê request chờ/chạy, công cụ điều phối hoặc thao tác quản trị. Metrics ẩn được tôn trọng cả ở selector, thanh Pod và tổng chi phí nhóm có thành viên ẩn. Số GPU hiện tại tính cả thành viên nhóm. Pod độc lập chỉ Chatbot/JupyterLab chỉ hiện ô dịch vụ được cấp; Pod hai dịch vụ giữ hai ô.
- Typecheck, 59 unit test và build đạt. Redis QA namespace riêng với provider/model giả lập tiếp tục đạt. Playwright `qa-grouped-workspace-ui.js` kiểm tra 0/1/2 GPU, chọn GPU, pause/resume, drain, thêm Pod chọn sẵn nhóm, owner/admin khác/thí sinh, metrics ẩn, dịch vụ đơn, desktop/tablet/mobile 320–390px; không tràn ngang hoặc pageerror. Kiểm tra lại `qa-pod-startup-ui.js` đạt. Ảnh ở `output/playwright/workspace-group-*.png` và `workspace-operations-*.png`.
- Đây là thay đổi web; không đổi image, quota, policy, restart hay cấp Pod thật để QA. Auth QA được đăng xuất và dữ liệu namespace QA được dọn sau kiểm tra.

## Xóa đội/thí sinh, retry capacity và đội theo vòng — 29/10/2026

- Admin có mục **Đội & thí sinh** dùng chung toàn hệ thống: tìm kiếm, xác nhận xóa, chuyển đội trưởng khi cần và lưu nhật ký xóa không chứa password. Xóa đội gỡ liên kết thành viên, giữ tài khoản; xóa thí sinh gỡ tài khoản/chỉ mục đăng nhập/đăng ký và chặn phiên cũ. Tài khoản admin được bảo vệ ở server và Lua. Giữ bài nộp và Pod đã cấp; UI nêu rõ Pod cần quản lý riêng.
- Allocation bị Runpod từ chối rõ do capacity được đánh dấu, giải phóng reservation theo phép so sánh ID và có nút **Thử cấp lại GPU**. Retry đối soát Pod cũ trước, dùng cùng khóa Pod với sync/control, tạo attempt ID mới có idempotency, giữ snapshot cấu hình và trần USD/giờ cũ. Mất ACK hoặc lỗi host không được tự retry. Hỗ trợ nhận diện thông báo capacity của record cũ; không di trú hoặc đổi snapshot Pod đang dùng.
- Dropdown cấp GPU riêng chỉ lấy đội có ít nhất một thành viên hiện tại được duyệt vào vòng đang chọn, phù hợp schema đăng ký theo thí sinh. Đổi vòng xóa lựa chọn không còn hợp lệ; kết quả fetch cũ bị bỏ qua. Backend kiểm tra lại và Lua kiểm tra quyền đủ điều kiện trước khi reserve/create. Pod chung tất cả đội giữ quy tắc cũ.
- Typecheck, 61 unit test và build đạt. `qa-admin-operations.ts` dùng Redis QA riêng/Runpod giả lập: xóa và gỡ đăng ký, chuyển đội trưởng, chặn hành động stale, giữ submission; retry đồng thời, sync/retry tranh khóa, template đổi sau capacity, callback mất ACK, xác nhận Pod đã tồn tại và bảo vệ admin khác. `qa-workspace-flow.ts` và `qa-chat-queue.ts` tiếp tục đạt.
- Playwright `qa-admin-operations-ui.js`: xóa tài khoản/đội QA thật qua HTTP/Redis, hủy xác nhận không xóa, phiên thí sinh đã xóa nhận 401, Origin sai và thí sinh bị chặn 403, admin bổ sung được phép quản lý, lọc đội giữa hai vòng, giữ retry ID sau network failure, desktop/mobile không tràn ngang hoặc pageerror. Ảnh `output/playwright/admin-roster-*.png`, `admin-approved-teams-*.png`. Lỗi network trong test retry được chủ động giả lập.
- Đã dọn các namespace/fixture và đăng xuất QA; không xóa đội/thí sinh thật hay tạo GPU tính phí để thử. Giữ nguyên thiết kế Chatbot theo yêu cầu hủy phần thu gọn.

## Chatbot xử lý đồng thời — 29/10/2026

- Template có lựa chọn 1/2/4/8 lượt đồng thời mỗi GPU; preset/form Chỉ Chatbot mới mặc định 4, cấu hình dùng chung Jupyter và allocation cũ mặc định 1. Thêm `ARENA_LLM_PARALLEL` khi cấp Pod, giữ context mỗi request và cấp tổng KV context theo số slot. Một tiến trình model dùng continuous batching; readiness đối chiếu số slot và context engine.
- Worker giao thức 2 có slot ID/capacity được server kiểm tra; giao thức 1 tiếp tục một slot. Claim/attempt, token reservation, session/đội/run và callback được bảo vệ khi chạy đồng thời. Đối soát nhiều job dùng một Lua script có giới hạn, giảm lượt HTTP/clock. Stop/terminate đặt drain trước khi đọc tất cả slot.
- Agent lưu journal riêng từng slot, đọc journal cũ ở slot 0, không chạy lại inference sau restart/mất xác nhận. Timeout 600 giây; slot có kết quả engine chưa rõ bị giữ cho tới khi xác nhận idle hoặc tiến trình đã dừng. Một lỗi không tự restart model và làm hỏng các slot khác. Endpoint theo dõi engine chỉ trên localhost 8080.
- Typecheck, 62 unit test, build production và 28 test Python CPU đạt. Build/Python cần chạy ngoài sandbox Windows do hạn chế mkdir/socket của sandbox; không phải yêu cầu truy cập GPU. Test Python giả lập inference chứng minh hai lượt chồng lấp và chặn vượt capacity, quarantine sau timeout, context từng slot, journal độc lập và phục hồi journal cũ.
- `qa-chat-queue.ts`: Redis thật trong namespace riêng, provider/model giả lập; thêm burst 28 request trên hai worker × bốn slot, chặn claim trùng/vượt slot/sai capacity, callback sai slot, uncertain riêng slot 3, drain khi slot 0 đã hoàn tất, tổng capacity tám và tương thích worker cũ. `qa-workspace-flow.ts` tiếp tục đạt; fixture/namespace được dọn sau QA.
- Playwright `qa-chat-concurrency-ui.js`: auth và lưu template QA thật qua HTTP/Redis; mặc định/lựa chọn 1/2/4/8, payload lưu và reload, snapshot allocation đang chạy giữ nguyên, thống kê nhóm tám slot và worker giao thức 2, ẩn lựa chọn ở Jupyter-only. Đã xem ảnh desktop/mobile `output/playwright/chat-concurrency-*.png`; không có pageerror. Thông tin worker/model được giả lập, chưa chứng minh throughput GPU thật.
- Phạm vi chỉ chatbot đồng thời; không thêm API/UI nhận Pod ngoài. Không cấp GPU, restart/thu hồi Pod thật hoặc chạy benchmark model thật trong QA. Phát hành image và web sẽ được ghi bổ sung bằng SHA/digest sau khi CI hoàn tất.

## Cloud All và thứ tự menu Admin — 29/10/2026

- Admin GPU Workspace có Cloud **All**, lưu và nạp lại template qua schema/API, gửi enum `ALL` trong một yêu cầu cấp Pod. Truy vấn tài nguyên không giới hạn `secureCloud`; dự toán và kiểm tra trần USD/giờ dùng giá catalogue hợp lệ cao hơn của Community/Secure. Menu **Quản trị vòng** đứng trước **Đội & thí sinh** khi đang xem vòng.
- Typecheck, 65 unit test và build production đạt. Ba test bổ sung kiểm tra schema/giá All, request tài nguyên và mutation cấp Pod đúng enum, một request. Build chạy ngoài sandbox Windows sau lỗi EPERM khi tạo thư mục prerender.
- `qa-workspace-flow.ts --keep` đạt với Redis trong namespace QA mới, provider/model giả lập. Playwright `qa-cloud-options-ui.js` kiểm tra API tài nguyên với cache QA, lưu template All qua HTTP/Redis và tải lại, chuyển Community/Secure/All, giá dự toán, thứ tự menu, desktop và mobile 390/320px. Không có lỗi console/pageerror/request hay tràn ngang trong luồng thử; đã xem ảnh `output/playwright/cloud-options-{desktop,mobile}.png`.
- Catalogue giá và tự động đối soát được giả lập trên trình duyệt; cache tài nguyên được nạp riêng cho QA. Không cấp/đổi/restart Pod thật để kiểm tra tính năng. Đã đăng xuất và xóa cookie trình duyệt QA; namespace và fixture được dọn sau kiểm tra.

## Lịch, quyền submission/chatbot và luyện sau thi — 29/10/2026

- Tách lịch/giai đoạn khỏi quyền nhận bài, hiển thị submission và chatbot/JupyterLab. Có điều chỉnh lịch đang chạy, private sớm giữ hạn kết thúc mặc định, hai lựa chọn chuyển private áp dụng đúng một lần, cấp lại chatbot có hạn, luyện sau thi cùng run/quota/BXH với một hạn chung. JupyterLab chỉ kiểm soát mở từ web; giữ kernel, tệp và Pod.
- Typecheck, 71 unit test và build production đạt. `qa-round-controls.ts` dùng Redis thật với namespace mới: 72 fixture đối chiếu TypeScript/Lua ở biên thời gian, chuyển private một lần, guard thời gian ngay lúc commit, request trùng, hai admin đồng thời/form cũ, khóa/ẩn khi nộp và quota tích lũy khi luyện tiếp. Các lượt QA tự dọn theo namespace.
- `qa-workspace-flow.ts` dùng Redis thật, Runpod/model giả lập: cấp lại chatbot trong private, job đã prepare bị thu hồi rồi cấp lại không phát phản hồi cũ, ẩn/hiện submission không khóa lại chatbot; manifest luyện tập không còn cutoff private đã qua, chat/Lab dùng được, khóa Lab và kết thúc luyện đúng quyền. Bộ đếm xác nhận các thao tác vòng mới không gọi create/stop/resume/terminate Pod; hồi quy provisioning và dịch vụ chung/riêng tiếp tục đạt.
- Playwright `qa-round-access-ui.js` chạy với HTTP/Redis QA thật và đề giả nội bộ: hai checkbox mặc định, sửa lịch giữ cả giây/millisecond và run/start, private sớm giữ giờ kết thúc, ẩn/hiện private, cấp lại chatbot, quyền admin 403 với thí sinh, ẩn submission trả 409, CSV rỗng ở split mở trả 422 và lưu lịch sử; luyện tiếp giữ run, cả hai split, chuyển private tự động và hết hạn chatbot. Desktop 1600px/mobile 390px không tràn trang/hộp thoại hoặc pageerror, không có HTTP 5xx. Đã xem ảnh `output/playwright/round-access-{private-desktop,timing-mobile,student-mobile}.png`; các ảnh lịch/luyện tập khác cùng tiền tố.
- Không thay image hoặc chạm Pod thật; kiểm tra này chưa đo model/GPU thật và chưa phát hành production. Trình duyệt QA đã đăng xuất/đóng; server local và fixture QA được dọn sau nghiệm thu.

## Luyện trực tiếp sau đặt lại và tùy chọn giữ BXH — 30/10/2026

- **Mở luyện tập tiếp** có trong trạng thái chưa bắt đầu/đã hẹn giờ/đã kết thúc. Chuyển từ lịch hẹn sang luyện tập có thông báo và hủy lịch bắt đầu thi. Đồng hồ/thẻ vòng hiển thị thời điểm bắt đầu luyện tập.
- **Đặt lại / mở lượt mới** dùng hộp thoại có lựa chọn giữ BXH, mặc định bật. Giữ BXH giữ cùng run, bài nộp và quota đã dùng; bỏ giữ tạo run mới, lưu riêng lượt cũ. Reset có run/revision/request ID, lưu snapshot nguyên tử, chặn trùng và form cũ. Hàng đợi chat được fence bằng epoch khi giữ run. Nhãn quyền đã đổi thành **Nhận bài nộp**.
- 74 unit test và build đạt. `qa-round-controls.ts` kiểm tra Redis thật trong namespace QA: giữ/xóa ledger và quota, snapshot lượt cũ, reset đồng thời/trùng request, nhận bài sau luyện trực tiếp và hủy lịch thi. 72 fixture TypeScript/Lua và các luồng trước tiếp tục đạt.
- `qa-workspace-flow.ts` với Runpod/model giả lập xác nhận reset giữ/đổi run rồi mở luyện trực tiếp, manifest/launch Lab gắn đúng run mới, Pod ID được giữ và không gọi create/stop/resume/terminate trong các thao tác này.
- Playwright HTTP/Redis QA thật kiểm tra điểm mẫu trước/sau giữ BXH, bỏ giữ tạo BXH trống, hủy xác nhận không đổi vòng, hai lựa chọn bắt đầu thi/luyện sau reset, luyện từ lịch hẹn và nhãn mới; desktop 1600px/mobile 390px không tràn hoặc pageerror. Đã xem ảnh `output/playwright/round-access-reset-{keep-desktop,clear-mobile}.png`. Các luồng chuyển private, submission, chatbot, expiry trước đó tiếp tục đạt. Auth, server và fixture QA được dọn sau kiểm tra; không sửa vòng hoặc Pod production để QA.


## Groq Chatbot — 05/11/2026

- Thêm chọn nhà cung cấp Runpod/Groq, khóa Groq riêng của admin được mã hóa, model đọc từ API, cấp chatbot riêng/chung theo vòng. Groq không tạo Pod hoặc sửa image/runtime GPU.
- `npm run typecheck`; 104/104 unit test; production build thành công. Windows cần build ngoài sandbox để Turbopack tạo junction cho pg.
- QA Groq dùng Supabase/Redis thật trong namespace riêng: cấp phát đồng thời/idempotency, quyền admin/đội, chống inference lặp, hai slot song song và trần bốn prompt/đội, input quá dài, 429/backoff/dừng sau ba lần từ chối, 401/refund, timeout/giữ reservation/đối soát owner, private chặn kết quả muộn, xóa/thay khóa và backup SQL mã hóa. PASS, 13 completion giả lập, 0 gọi Groq thật.
- QA SQL/Redis hiện có PASS: reservation Runpod đồng thời, claim/prepare/complete, cache eviction, lịch sử bền vững, quyền SQL, reset/quota, Hub và backup/restore. Không tạo GPU thật.
- Playwright desktop 1440×1000 và mobile 390×844: chọn provider, lưu khóa giả lập/xóa input, danh sách model, payload cấp phát, card API không hiện Pod/đơn giá giờ; phản hồi Groq giả lập; hai tab, refresh và chat mới. Không có lỗi JS trong lần kiểm tra sạch. Ảnh trong output/playwright/groq-*.png (nội bộ). QA phiên chat chung PASS cả hai browser context và /new.
- Production Node local trong namespace QA rỗng: instrumentation khởi tạo Groq scheduler; health có startedAt, lastPollAt và lastSuccessfulPollAt. Health không thực hiện DB/provider call.
- Migration additive `20261105110732_chatbot_api_credentials` đã áp dụng Supabase; advisor security không có lint mới. Khóa mã hóa/credential Runpod và dữ liệu vòng thật giữ nguyên.
- Chưa nghiệm thu inference thật/tốc độ/chi phí Groq khi admin chưa nhập API key thật trên web.

- Phát hành Render `dep-dbm6nmgu01pc738i84gg`: **live**, commit ứng dụng `10c0b90c9ce24dda2922a8d4697ea07631fca7f5`, lúc 18:44 ngày 05/11/2026 (giờ Việt Nam). Push không tạo auto deploy; đã xác minh không có deploy mới/đang chạy rồi trigger một lần Manual Deploy.
- Smoke `https://olpaiarena.cyou` PASS: health đúng SHA/postgres, scheduler Groq đã khởi tạo và poll SQL thành công; API Groq chặn anonymous, CSRF và payload cấp phát thiếu; metadata credential không lộ ciphertext/key/revision. Admin hiện chưa cấu hình khóa Groq thật.
- Smoke Render chung PASS: đăng nhập/đăng xuất, đọc 5 vòng/đề, 98 Workspace lịch sử, 0 Workspace active; credential Runpod cũ vẫn giải mã và đọc giá GPU được. Không có mutation Pod/vòng.
- Smoke browser production desktop/mobile PASS: chọn Groq, form key/model/quota hiện đúng, không tràn ngang mobile, không có lỗi JS trong luồng kiểm tra; đối chiếu đúng SHA và scheduler. Chỉ đọc, không lưu khóa hoặc cấp chatbot thật; phiên QA đã đăng xuất và auth state đã dọn.

## Lịch sử đội và giao diện Trợ lý AI — 05/11/2026

- Chuyển chọn provider/kết nối Groq xuống dưới các GPU đã cấp. Thí sinh dùng nhãn Trợ lý AI, không có thông tin provider/model từ cấu hình admin. Thông báo chờ tài nguyên chỉ dành cho nhóm Runpod chưa có Pod; link lịch sử vẫn mở được khi quyền gửi đóng.
- Sidebar lưu các cuộc theo đội/vòng; refresh giữ lựa chọn, tab mới có UUID mặc định riêng, chat mới giữ cuộc cũ. Token còn lại ở góc trên phải theo cuộc đang xem; ký tự Unicode của bản nháp ở góc dưới phải ô nhập. Lịch sử không hết hạn; các run/dịch vụ cũ chỉ đọc, không trộn context/token với lượt mới.
- Typecheck, 107/107 unit test và production build PASS. QA Supabase/Redis thật trong namespace riêng PASS: hai thành viên cùng đội, chặn đội/vòng khác và lane admin, cache bị xóa hoặc cache legacy thiếu metadata, giữ usage, finish/reset/retire, backup/export/import. Ba completion giả lập, không gọi provider thật. Hồi quy SQL/Redis Runpod, reset/quota, Hub và backup/restore trước đó PASS sau sửa phục hồi cache vĩnh viễn.
- Phân trang 55 cuộc PASS, không trùng/mất mục giữa hai trang. Playwright HTTP/SQL/Redis QA thật PASS ở 1440×1000 và 390×844: token của archive, 10 ký tự cho `Xin chào 😀`, chỉ đọc, refresh, mobile drawer không tràn, chat mới giữ lịch sử, cố ý giữ ACK rồi chuyển cuộc, kết quả không ghi đè archive, phản hồi lưu cho cả đội, browser mới không tự chọn cuộc của máy khác, đội khác không thấy lịch sử. Đã xem ảnh `output/playwright/chat-history-*.png` và `history-admin-layout.png`. Provider worker được giả lập; không tạo GPU.
- Migration Supabase `20261105125753_durable_team_chat_history` đã áp dụng: 1.357 snapshot production giữ vĩnh viễn, 1.287 snapshot gắn được audience/vòng từ bằng chứng sẵn có. 70 snapshot private legacy không có dữ liệu tác giả được giữ nguyên nhưng không tự gán cho đội/admin. Security advisor không có lint. Một lượt QA trùng thời điểm DDL bị lock timeout; đã dọn namespace riêng và chạy lại độc lập PASS.
- Đã đăng xuất bốn tài khoản QA, đóng browser/dev server và dọn các namespace fixture. Không sửa vòng/Pod production để QA. Chi tiết quyền và retention ở [CHAT_HISTORY.md](CHAT_HISTORY.md); nghiệm thu phát hành ghi riêng sau khi xác nhận live SHA.

- Phát hành Render `dep-dbm7tk88v5cc73drbik0` **live** lúc 20:05 ngày 05/11/2026 (giờ Việt Nam), đúng commit ứng dụng `56148bcb6956ca5be9a01f6bc43992a7f51c25ed`. Push không sinh deploy mới; đã kiểm tra danh sách trước khi trigger một Manual Deploy.
- Smoke production PASS: health đúng SHA/postgres, Groq scheduler poll thành công; API lịch sử của hai nhóm thật đọc được, chặn anonymous và tham chiếu không hợp lệ, Groq không có placeholder GPU. Smoke Render chung PASS: đăng nhập/đăng xuất, năm vòng/đề, 98 Workspace lịch sử, khóa Runpod cũ giải mã/đọc giá được, không có mutation Pod/vòng. Audit retention cuối: 1.357 snapshot, không có snapshot cuộc trò chuyện còn hạn xóa.
- Browser production desktop/mobile PASS: form Groq nằm dưới GPU, sidebar, badge token, ký tự Unicode, không tràn ngang hoặc pageerror. Chỉ đọc; không gửi prompt bằng key thật. Hồi quy `qa-chat-sessions.js` và `qa-groq-ui.js` trên bundle production PASS với API/provider giả lập, gồm hai tab/hai browser context, refresh, chat mới và `/new`. Đã sửa fixture viewport để phần chat mobile của QA thực sự chạy 390px. Ảnh `chat-history-production-*.png`; đã xem giao diện chat và drawer mobile. Đã đăng xuất, đóng browser và xóa auth state production.

## Tải GPU Workspace theo từng phần — 05/11/2026

- Khung chờ được stream từ server trước khi xác thực xong; client giữ bố cục/skeleton khi chờ dữ liệu. Workspace đã mở được giữ trong cây React của trang, tách theo user/admin/team, hiện lại nội dung trước khi cập nhật nền. Dừng polling/sync khi ẩn; hủy read cũ, gộp request đang chạy, khóa thao tác quản trị tới khi snapshot mới được xác minh. Lỗi/timeout và thử lại theo từng khu vực; giá không chặn dịch vụ đã cấp.
- API `view=current/history`, mặc định `all` để tương thích; UI chỉ tải GPU đã thu hồi khi mở tab. Counts dùng phạm vi đội/vòng, đọc visibility theo lô; các hàng được chọn vẫn kiểm tra policy mới. Đọc độc lập chạy song song, không đọc worker telemetry của record đã thu hồi. Không đổi schema, retention chat, image hoặc lifecycle Pod.
- Typecheck, 107 unit test và production build PASS. QA mới trên Supabase/Redis thật PASS: 90 Workspace, current 1/history 89, counts không lộ đội khác/vòng ẩn/đã xóa, giữ redaction và API đầy đủ; không có read telemetry cho Pod đã thu hồi hoặc gọi provider. QA SQL đầy đủ PASS (queue/quota/reset/Hub/cache/backup); QA Workspace Redis cũ PASS (provisioning/concurrency/reservation/private/reset/token, Runpod/model giả lập).
- Playwright trên production build local PASS ở desktop 1440×1000/mobile 390×844: giữ API arena/state/history/giá, skeleton và Chatbot vẫn hiển thị; lazy history + retry, giá lỗi riêng + retry, quay lại giữ nội dung, 11 giây khi ẩn không poll, focus + một interval cùng dùng một request, lỗi giữ cache, khóa admin rồi phục hồi. Không có pageerror; lỗi HTTP 503 trong luồng này được cố ý giả lập. Hồi quy Groq UI/phiên chat PASS; sync trong fixture được stub để không gọi Pod.
- Phông Be Vietnam Pro/IBM Plex Mono được phục vụ từ static assets, Fontsource 5.3.0 ghim phiên bản, `font-display:swap`. Đã tái hiện stylesheet Google chậm làm DOM có sẵn nhưng chưa paint. Bản mới: browser context mới, chặn Google và giữ toàn bộ font nội bộ chưa trả; first contentful paint 84 ms, 0 request font ngoài, font nội bộ tải được sau khi thả response.
- Đo local mẫu: server shell được gửi ở 62 ms, HTML hoàn tất 767 ms. Cùng fixture 90 records: current 1.949 byte/1 hàng, full 90.278 byte/90 hàng; current 1,75–1,86 giây, full 2,26 giây. Đây là mẫu QA, không phải cam kết latency production. Ảnh `workspace-loading-{shell,desktop,mobile,recovered}.png` đã xem. Cookie/fixture namespace được đăng xuất và dọn; kết quả phát hành ghi riêng sau khi xác nhận live SHA.

- Render `dep-dbma94ff3r2c7382vo8g` **live** lúc 22:46 ngày 05/11/2026 (giờ Việt Nam), đúng commit `e0ce1c0555ef75ec3bdaae1ce1e0ab3748e37722`. Push không tạo deploy tự động; đã kiểm tra không có deploy mới/đang chạy rồi trigger một Manual Deploy.
- Smoke production PASS: health đúng SHA/postgres và scheduler hoạt động; đăng nhập/đăng xuất, năm vòng/đề, 98 Workspace lịch sử, credential Runpod cũ giải mã và đọc giá được. `current/history/all` đúng phạm vi và counts; view sai trả 400, anonymous trả 401, không lộ secret trong DTO. Current payload 12.080 byte so với full 173.404 byte; số đo latency riêng lẻ dao động theo warm-up/traffic, không dùng để khẳng định mỗi request luôn nhanh hơn. Không gọi inference hoặc điều khiển Pod/vòng.
- Browser production desktop/mobile PASS, không tràn ngang/pageerror. Ba lần mở mới: shell có trong DOM ở 119–262 ms, first contentful paint 152/160/1.440 ms, danh sách Chatbot/GPU ở 1.168/1.295/2.730 ms. Quay lại mục Workspace giữ nội dung và hiện trong 49 ms. Không có request tải trước history hoặc font ngoài. Kiểm thử context mới giữ response font nội bộ: trang vẫn paint ở 416 ms và font nội bộ tải đúng sau khi thả. Đây là mẫu nghiệm thu, không phải SLA; dữ liệu dịch vụ vẫn cần chờ mạng/server.
- Đã xem ảnh `workspace-loading-production-{desktop,mobile}.png` và bộ ảnh QA; đăng xuất/đóng browser, xóa auth state. Namespace QA loading còn 0 record state sau dọn. Commit tài liệu sau phát hành không yêu cầu deploy lại.
# Core/Groq SQL, Runpod Redis — 06/11/2026

- Application commit `48a16ba5dbe152a1f1a7361a44c6a50b940cf20c`, Render deployment `dep-dbmk44etlv9c73b8esa0` live. Health tên miền chính xác nhận postgres cho database/Groq và Runpod disabled; maintenance đã gỡ đúng ID sau khi xác minh SHA.
- Typecheck, 107 unit tests và production build local PASS. Security advisors sau migration không có cảnh báo. SQL QA riêng không có Redis credential PASS; hồi quy Runpod/Hub dùng Redis thật/provider giả lập PASS. 429, timeout, duplicate/parallel, token reservation, late callback/private và encrypted native backup/restore đã kiểm tra; không dùng GPU hoặc inference thật.
- Playwright desktop/mobile PASS; đã xem ảnh `output/playwright/sql-runtime-{workspace-desktop,workspace-mobile,chat-mobile}.png`. Browser → API thật → SQL thật → Groq giả lập → SQL → browser và refresh giữ phản hồi PASS; các kiểm tra hai tab/chat mới hồi quy PASS. Cookie/namespace QA đã dọn.
- Cutover chuyển 62 session còn hạn và một CSV dự phòng Redis sang SQL; byte/checksum khớp, backup mã hóa trước/sau lưu riêng `.local/`, không xóa Redis key. Sau phát hành giữ 46 user/245 bài; file: 244 Blob, một SQL; không có active job. Nhóm Groq có sẵn vẫn pause.
- Smoke production PASS: đăng nhập/đọc/đăng xuất, năm vòng, 98 Workspace lịch sử, Groq configuration và danh sách năm model với credential thật; API Runpod trả 503 theo mode. Không gọi inference, không điều khiển Pod/vòng, chưa benchmark tải nhiều đội.
- Xem `docs/REDIS_SQL_RUNTIME.md` trước vận hành. Runpod gồm Jupyter-only/Hub vẫn cần Redis khi bật; Vercel chưa thay đổi.
# Truy cập khách và Auth — 06/11/2026

- Ghép với main `882cca749230e6bb97080950779a5c13281b3d9a`, giữ catalogue, hiển thị điểm và bộ chấm ZIP mới.
- TypeScript qua; 111 unit test qua tuần tự. Ban đầu dùng cấu hình giảm cache/worker vì ổ C đầy; sau khi có dung lượng, `npm run build` nguyên gốc cũng qua. `next.config.ts` giữ nguyên, không phát hành cấu hình QA.
- HTTP dùng Supabase SQL thật trong namespace QA riêng, Supabase Auth giả lập: trang chủ khách 200; đề/BXH xem công khai; ẩn/chưa công bố đúng quyền; API download/nộp/đội/Workspace/admin chặn khách; legacy login; Google linking giữ ID/đội; chặn email trùng và metadata role giả; signup không tạo phiên trước xác nhận; PKCE callback giữ đích; reset thu hồi session cũ; concurrent identity mapping không nhân đôi.
- Playwright qua desktop 1440×1000 và mobile 390×844 trên bản merge: đề/BXH, màn hình yêu cầu đăng nhập, không gọi Workspace khi là khách, Google button trong chế độ QA, đăng ký chờ xác nhận, legacy login quay về dữ liệu, logout. Không lỗi page hoặc tràn ngang. Đã xem ảnh render desktop/mobile; ảnh ở `output/playwright/public-*.png`.
- Export/import/verify SQL thật sang namespace restore riêng giữ các auth identity đang hoạt động. Migration `20261106135314` bật RLS; anon/authenticated không đọc được, backend theo namespace. Supabase security advisor không có lint.
- Không gửi email thật, không đăng nhập Google thật, không tạo Pod. Google provider của project còn tắt ở lần kiểm tra; production giữ `ARENA_AUTH_MODE=legacy` cho tới khi Google/Resend/redirect được người vận hành cấu hình và xác minh. Hướng dẫn: `docs/PUBLIC_ACCESS_AUTH.md`.

# Giao diện khách, tên Google và mẫu email — 07/11/2026

- Bỏ banner/ghi chú khách theo yêu cầu; nhãn Khách/OlpAI Arena, nút tạo tài khoản trắng ở header. Màn hình yêu cầu đăng nhập có tiêu đề/nút lớn, dữ liệu khóa có nền skeleton mờ không chứa asset thật. Ngày/giờ trong BXH và lịch sử nộp xếp hai dòng nhỏ; title chỉ gạch chân khi hover đúng chữ, hero nâng nhẹ/sáng viền và giữ nền.
- Google mới được yêu cầu nhập tên một lần; chặn email làm tên, chặn thao tác riêng trước khi hoàn tất, giữ tên qua đăng nhập lại. Tài khoản cũ liên kết Google giữ ID/đội/tên. Migration `20261106200126` chỉ bổ sung trạng thái hoàn tất tên, không đổi quyền hoặc nội dung người dùng.
- TypeScript/build qua; 113 unit test qua tuần tự. HTTP/SQL thật trong namespace QA riêng + Supabase Auth giả lập qua các luồng cũ, onboarding, profile gate, reset mật khẩu và thu hồi session. Backup/restore SQL giữ trạng thái tên; unit test đọc được hàng backup ba cột trước onboarding.
- Playwright desktop 1440×1000 và mobile 390×844 kiểm tra header/nhãn, không tràn ngang, hover nền/card/title, cột ngày, Google không điền sẵn tên và giữ tên tự chọn, gửi lại email sau 60 giây. Hủy dialog không gửi request; chấp nhận gửi đúng một request. Có một 429 dự kiến vì dùng lại email recovery trong khoảng giới hạn; lần kiểm tra UI sau dùng địa chỉ QA khác. Không gửi thư thật hoặc tạo Pod.
- Hai mẫu HTML Confirm sign up/Reset password và README tại `docs/email-templates/`; gói bàn giao `output/email-templates/OlpAI_Arena_Supabase_Email_Templates.zip`. Đã xem preview desktop/mobile cho cả hai, dùng URL minh họa. Mẫu chưa được tự dán vào Supabase; người dùng sửa Source theo nhu cầu. Preview trình duyệt không chứng minh hiển thị giống nhau ở mọi mail client.
- Advisor không báo lỗi RLS cho bảng ánh xạ; còn cảnh báo Auth [Leaked Password Protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) đang tắt trong cấu hình hiện có. Chưa thay chính sách hoặc gói dịch vụ.



# Tài khoản, email và OAuth branding — 07/11/2026

- Đã xóa hai ghi chú tài khoản theo yêu cầu; UI tên/email theo hàng riêng, hiển thị ngày được sửa tiếp; ẩn password form cho phiên Google. Đội trưởng có sửa tên đội trong panel Đội của tôi.
- 114 unit test qua; kiểm tra HTTP/SQL thật tại namespace `arena:qa:account:<uuid>`, Auth/SMTP giả lập: guest 401; tên không hợp lệ; hai rename đồng thời chỉ một thành công; 30 ngày mở lại đúng; email trùng; sai mật khẩu; đổi Google nhầm subject; xác nhận hai hộp thư; GET scanner không verify; replay token; thu hồi phiên; ID/đội/tên giữ nguyên qua email và login Google mới; backup/export/import/verify cả metadata mới sang restore namespace riêng. Hồi quy `scripts/qa-public-auth.ts` cũng qua.
- Playwright desktop 1440×1000/mobile 390×844: form email/Google, cooldown, đổi tên Google qua UI, captain rename, thành viên không có nút rename, email dialog hủy không request/chấp nhận đúng một request, pending email, các trạng thái xác nhận và hai trang chính sách không tràn ngang. Đã xem ảnh trong `output/playwright/account-*.png`, `legal-*.png`; không lỗi page, có hai gợi ý password-manager trước khi thêm hidden username. Email preview desktop/mobile đã xem với địa chỉ và token giả.
- Typecheck/build production qua. Build trong Windows sandbox gặp lỗi quyền tạo junction của Turbopack; chạy ngoài sandbox thành công, không sửa next.config để né lỗi. Không tạo Pod, không gọi mô hình hoặc gửi email thật; Google/SMTP trong kiểm thử trên là provider giả lập.
- Migration đã áp dụng trên đúng Supabase `olpai-arena`, RLS bật, anon không SELECT/authenticated không UPDATE bảng account_profiles. Advisor không có lỗi RLS; cảnh báo hiện có [Leaked Password Protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) vẫn chưa bật, không tự đổi gói/cấu hình Auth.
- Mẫu `Change email address` và ZIP `output/email-templates/OlpAI_Arena_Account_Email_OAuth.zip` giữ biến Go template, không chứa credential hoặc token thật. Logo 120×120 PNG 2.368 byte; 512×512 16.155 byte. Hai trang dùng support email do người dùng chọn `nhatlong30042006@gmail.com`. Người dùng tự dán HTML và nộp Verify/Publish branding; việc duyệt thuộc Google.


# Phương thức đăng nhập và Tài khoản — 07/11/2026

- UI thể hiện email xác minh, Google đã liên kết, mật khẩu có/chưa có và email OTP/Magic Link theo trạng thái thực tế trong Supabase; Google chưa có mật khẩu xem email chỉ đọc, thiết lập mật khẩu bằng OTP trước khi bật đổi email. Google đã có mật khẩu đổi được với mật khẩu hiện tại, kể cả phiên đăng nhập Google. Cùng Arena user/team ID, không tạo tài khoản phụ.
- Migration `20261107064210_arena_auth_methods.sql` đã áp dụng vào project `prgbpkscymbihbhtando`; hàm chỉ đọc trong schema private, không thay Auth user thực tế. Xác minh EXECUTE: anon=false, authenticated=false, arena_backend=true. Advisor không phát hiện lỗi mới liên quan hàm; còn cảnh báo có sẵn về Leaked Password Protection tắt.
- Typecheck, 114 unit test và production build qua. PostgreSQL 18 dùng riêng trên loopback, Auth/SMTP giả lập: hai script `qa-account-settings.ts`, `qa-public-auth.ts` qua. Bao gồm mã sai subject, sai/đã dùng, nhập lại không khớp, Google thêm mật khẩu rồi đăng nhập password, đổi password từ phiên Google, thu hồi phiên, khôi phục chọn đúng redirect loại thư, OTP, Magic Link khác trình duyệt và GET không tiêu thụ token, onboarding, collision, PKCE, quyền đội/khách, email hai bước và export/restore. Không gửi email thật/Google thật, không tạo GPU.
- Playwright desktop 1440px/mobile 390px qua: login bằng OTP đến đúng user/đội; trạng thái Google có mật khẩu; Google-only email chỉ đọc và hoàn tất thiết lập mật khẩu bằng form qua API/database; password confirmation, thiếu Magic Link, hồi đáp forgot chung. Không page error/HTTP 5xx/tràn ngang. Đã xem ảnh desktop/mobile trong `output/playwright/auth-methods-*.png`; dữ liệu ảnh là fixture QA. Có thông báo DOM verbose của Chrome về hidden username trong password form, không phải lỗi JS.
- Người dùng chọn tự cập nhật hai email template và hai Redirect URL trong Supabase. Hướng dẫn ở `docs/ACCOUNT_AUTH_METHODS.md`. Chưa kiểm tra email thật hoặc tuyên bố các template đã được lưu trên Dashboard. Người dùng đã xác nhận lưu cấu hình email trước lần phát hành giao diện rộng và trường Trường.


# Tài khoản rộng, thẻ bo góc và Trường — 07/11/2026

- Loại bỏ giới hạn 580px của trang Tài khoản. Theo yêu cầu làm rõ cuối cùng, các mục dùng chung một bảng trắng rộng, nhãn đặt ngoài ô giá trị bo góc; heading 28–32px, nhãn 21px, giá trị 22px, chữ trợ giúp 15px; form mật khẩu hai cột trên desktop và một cột trên mobile. Chỉ đổi bố cục của trang Tài khoản.
- Trường là hồ sơ riêng có thể sửa/để trống, tối đa 160 ký tự. API yêu cầu đăng nhập, luôn dùng user ID từ session; chuẩn hóa khoảng trắng/Unicode, kiểm tra giới hạn, ghi SQL với namespace RLS và giữ các mốc đổi tên/email. Backup giữ trường mới và đọc được bản sáu cột cũ.
- Typecheck, 114 unit test và production build qua. QA dùng PostgreSQL cục bộ và Auth giả lập; kiểm tra lưu/đọc lại trường sau đăng nhập, xóa để trống, quá giới hạn và không thể chọn user khác qua payload. Người dùng xác nhận tự lưu cấu hình email Supabase trước triển khai.

- Playwright đã kiểm tra 1440/1024/768/390/320px, lưu Trường qua form rồi reload vẫn giữ giá trị, không tràn ngang/lỗi JS/HTTP 5xx. Đã kiểm tra ảnh và sửa thẻ hồ sơ ở mobile để nhãn loại tài khoản xuống hàng riêng, không ép tên/email thành cột hẹp. Ảnh QA trong `output/playwright/account-layout-*.png`.
- Migration `20261107100612_arena_account_school.sql` đã áp dụng vào Supabase; xác nhận `school_column_ready=true`, `rls_enabled=true`. Không thay tài khoản hay trường của người dùng thật để thử UI.


# Phân nhóm vòng luyện, bộ lọc một hàng và Tài khoản gọn — 07/11/2026

- Ba nhóm Thi thử Olympic AI, Luyện tập chuyên đề, Thi tuyển chọn, kèm phân loại phụ. Admin chọn trước phát hành và sửa lại sau phát hành; kiểm tra quyền/run/revision trên server. Nút phát hành nằm đầu trang. Tổng quan giới hạn Mới nhất 4 thẻ, mỗi nhóm 2 thẻ, hai cột desktop/một cột mobile; Xem tất cả mở danh sách phân trang 8 vòng. Tìm tên, dropdown nhóm bốn lựa chọn, phân loại phụ, trạng thái và sắp xếp cùng một hàng trên desktop. Đã bỏ phần giới thiệu lớn và hàng tab nhóm; icon cam/vàng/xanh/tím. Dòng dưới Mới nhất là “Đang diễn ra & sắp mở” theo yêu cầu.
- Hoạt động Mới nhất dựa trên phát hành/bắt đầu/mở luyện lại; không tính lịch tương lai hoặc sửa nhãn, reset giữ mốc trước. Nhãn/mốc lưu trong JSON config hiện có, không cần DDL Supabase mới. Các vòng legacy mặc định Thi thử, tên Regional là Chuyên đề; script xem trước rồi lưu bằng API quản trị, không thay lựa chọn admin đã lưu.
- Tài khoản giảm typography và khoảng cách một mức, giữ bảng rộng và các giá trị trong ô bo góc cùng trường Trường.
- Typecheck, 118 unit test và production build PASS. HTTP/API với PostgreSQL 18 loopback, namespace QA riêng PASS: thứ tự sự kiện/reset, cạnh tranh sửa nhãn chỉ một request thành công, chặn guest/student, không lộ vòng ẩn, nhãn không hợp lệ trả 400, phát hành có nhóm và sửa sau phát hành. Không mutation vòng production để QA.
- Playwright PASS desktop 1440/1024/768px, mobile 390/320px: bộ lọc một hàng desktop, không còn tab nhóm, giới hạn/số cột, tìm kiếm/dropdown/trạng thái, phân trang, phát hành từ UI, đổi nhóm sau phát hành và reload, quyền student, Tài khoản gọn; không JS error/HTTP 5xx/tràn ngang. Hộp thoại xác nhận browser đã xuất hiện; lượt tự động cuối stub confirm để công cụ đợi đủ luồng. Đã xem ảnh desktop/mobile trong output/playwright/round-groups-*.png và account-compact-*.png. Không gửi email hoặc tạo GPU.
