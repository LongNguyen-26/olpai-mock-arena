# Runpod: các lỗi đã gặp và cách tránh lặp lại

## JupyterHub từ chối cookie secret trên NFS — 30/10/2026

- **Đã xác nhận từ log mới:** image `5141126f…` đã tải và khởi động container, nhưng Hub thoát với `cookie_secret_file can be read or written by anybody`. Agent dừng theo Hub, Runpod khởi động lại container. Chưa có Lab team; đây không phải lỗi cache trình duyệt hoặc tải image.
- **Cách sửa:** tạo secret bằng mode `0600` ngay lúc tạo tệp; giữ bản gốc trên volume dưới thư mục root `0700`, rồi tạo bản cookie phục vụ Hub trên filesystem cục bộ `/run/arena-hub` với thư mục `0700` và tệp `0600`. Giữ nguyên giá trị để phiên không bị vô hiệu sau restart. Không tắt kiểm tra quyền cookie, auth, XSRF hoặc Origin của JupyterHub.
- Nếu thư mục điều khiển không giữ được quyền root `0700`, runtime báo lỗi và không chạy. Nếu bản khóa lưu không còn là khóa hex hợp lệ, runtime giữ nguyên và báo lỗi, không tự tạo đè khóa mới.
- Hồi quy Linux khởi động Hub với bản secret lưu trên volume có mode `0666`, kiểm tra bản cục bộ `0600`, cùng giá trị, team không đọc được cả hai, và khóa hỏng không bị xoay ngầm. Không yêu cầu người dùng bật hoặc thay image Pod hiện tại để chạy CI.

## JupyterHub: NFS từ chối đổi UID — 30/10/2026

- **Đã xác nhận trên Pod người dùng:** Hub/API đã chạy, còn đủ RAM/đĩa, nhưng `os.chown` home team trên `/workspace` trả `EPERM`. `/tmp` cho phép chown; `/workspace` là NFS4 trong container có UID remapping. Tạo thư mục/tệp trực tiếp bằng UID team thành công, team khác bị chặn; root trong container nhận `EACCES` khi đọc home `0700` của team.
- **Cách sửa:** tạo home dưới UID team trong staging chỉ quản trị truy cập, rồi rename ra thư mục team. Ghi thư mục, notebook, kernel và kiểm tra venv dưới UID đó; truyền FD đọc của đúng nguồn thay vì mở toàn bộ thư mục điều khiển cho team. Không dùng chown trên dữ liệu team, không đổi home thành thư mục dùng chung và không chuyển dữ liệu sang `/tmp`.
- Home root sở hữu còn trống do lần khởi tạo lỗi được tạo lại. Home sai chủ đã có tệp được giữ nguyên và yêu cầu quản trị xem xét; không tự xóa hoặc thay quyền hàng loạt.
- Trang đăng nhập phải dừng chờ và hiển thị lỗi nếu report team là `error` hoặc team đã dừng. Chỉ tự kiểm tra lại với trạng thái chuẩn bị/khởi động/chờ tài nguyên, tối đa ba phút. Hub Ready và Lab Ready vẫn là hai trạng thái riêng.
- CI Linux có ca mô phỏng NFS chặn chown và root đọc home, kiểm tra chủ tệp thật, home `0700`, team khác không đọc được, và giữ tệp khi gặp home sai chủ. Kiểm chứng trên filesystem Linux không thay thế nghiệm thu Lab/kernel/WebSocket/CUDA trên Pod mới.

Ghi nhận từ quá trình triển khai/nghiệm thu ngày 27/10/2026. Phân biệt lỗi đã có phản hồi thực tế, giả thuyết và trạng thái chưa kiểm chứng. Không lưu API key, token Jupyter/agent, cookie đăng nhập hoặc signed URL trong tài liệu/log/Git.

## 1. Không có Pod dù web hiện đang đối soát

- **Đã xác nhận:** A40 Community trả HTTP 200 nhưng có `errors[].extensions.code = SUPPLY_CONSTRAINT`, `data.podFindAndDeployOnDemand = null`. Catalog có giá không có nghĩa cloud đó còn máy. Cùng thời điểm A40 Secure cấp được với giá GPU $0,59/h.
- **Cách xử lý:** kiểm tra cả status HTTP lẫn envelope GraphQL, phân loại lỗi hết tài nguyên là thất bại rõ ràng. Kiểm tra availability của đúng cloud/GPU và điều kiện RAM/vCPU/CUDA. Không âm thầm đổi cloud/giá hoặc gửi lại sau timeout.
- Trước mỗi lần thử lại, đối soát danh sách tài khoản theo Pod ID hoặc tên cấp phát bền vững. Timeout/5xx/mất body có thể đã tạo Pod; giữ reservation khi chưa xác định được. Lỗi query không được biến thành danh sách Pod rỗng.
- Từng gặp HTTP 400 với cấu hình REST v1. Enum v1 không nhận mọi phiên bản CUDA mới; host thực tế báo CUDA 13.2 trong khi bộ lọc cố định chỉ tới 13.0 sẽ loại host tương thích. Web hiện dùng GraphQL `podFindAndDeployOnDemand` với `minCudaVersion: "12.8"`. Không có raw body ban đầu để quy mọi HTTP 400 về cùng một nguyên nhân.
- File Python SDK do người dùng đưa dùng GraphQL, còn script requests dùng REST v2. Khác biệt là endpoint, schema, lựa chọn cloud/tài nguyên và cách đọc lỗi; không kết luận thư viện HTTP tự nó gây lỗi. SDK có thể đổi API theo phiên bản: đối chiếu payload thực tế và tài liệu trước khi sửa.

## 2. Web tính tiền nhưng chưa có Pod ID

Đã có lỗi gán giá dự kiến cho yêu cầu `reconciling`, làm hiện chi phí $0,0054 dù Runpod chưa tạo Pod. Đã sửa: chưa xác nhận Pod ID thì meter rate và chi phí hiển thị bằng 0, kể cả record cũ. Chỉ bắt đầu ước tính sau xác nhận. Chi phí web vẫn là ước tính, không phải chứng từ hoặc bằng chứng đã có Pod.

## 3. RUNNING / Jupyter đăng nhập được chưa đủ để báo sẵn sàng

`desiredStatus = RUNNING` có thể xuất hiện khi image còn pull hoặc container chưa phục vụ xong; lúc này runtime telemetry có thể null. Trước đây probe `/login` trả 200 đã khiến web bật nút quá sớm.

Kiểm chứng theo thứ tự:

1. Pod thật tồn tại đúng tài khoản, đúng ID/name/image; xem system log pull/create/start và telemetry.
2. Agent `/health` có xác thực phản hồi; Jupyter `/lab` có xác thực trả trang Lab, không phải trang login.
3. Proxy port 8888 phản hồi `/api/status`. Runpod gọi route này không có token; trước đây route trả 403 nên dashboard hiện Initializing kéo dài.
4. Chỉ route readiness `/api/status` được trả JSON tối thiểu không token. Khi có token vẫn giữ schema status chuẩn của Jupyter. `/api/contents`, `/api/kernels`, terminal vẫn phải xác thực; không tắt auth để làm dashboard xanh.
5. Chờ **menu/file browser/launcher render đầy đủ**, rồi chạy phép tính qua kernel trong browser. Một `.jp-LabShell` xuất hiện hoặc screenshot còn splash/loading không chứng minh Lab đã dùng được.

## 4. WebSocket 403 qua proxy dù HTTP 200

**Đã xác nhận trong log:** Origin là domain `https://<pod-id>-8888.proxy.runpod.net`, nhưng Host được proxy chuyển thành IP:port nội bộ. Jupyter ghi `Blocking Cross Origin API request`; event stream và kernel browser có thể bị chặn dù GET có token vẫn đạt.

Đã sửa config: `ServerApp.trust_xheaders = True`, `ServerApp.allow_origin` đúng domain của **chính Pod đó**, lấy từ `RUNPOD_POD_ID`. Không dùng wildcard, không tắt XSRF/auth. Phải kiểm tra bằng browser/cookie và WebSocket thật; request API có token có thể theo cơ chế kiểm tra Origin khác. Đã chạy `1 + 1` qua browser kernel và nhận `2`, sau đó xóa kernel QA.

## 5. Reset/mở lại đề nhưng Notebook bị 403, Chatbot vẫn khóa

Reset đổi `Contest.id` (run ID), còn round ID ổn định. Workspace từng giữ run ID cũ nên bị báo “Notebook chỉ mở trong lượt thi được cấp GPU”, manifest inactive và model bị tắt.

Đã sửa: gắn Pod theo round, tự cập nhật run metadata nguyên tử, giữ Pod/volume và không ghi đè kết quả sync đồng thời. Chat/token tách theo run. UI và backend dùng cùng điều kiện quyền/pha/readiness; tab chat tự sync readiness dù không mở dashboard. Sau inference phải kiểm tra lại run/pha, không phát phản hồi của run cũ sau reset.

## 6. GGUF tải đủ nhưng GPU vẫn 0 MiB, mở public không nạp lại model

**Đã xác nhận:** file Q4_K_M đủ 19.851.335.840 byte, CUDA nhận A40 nhưng llama chưa chạy. Worker cũ chạy một lần, thoát khi gặp private/run không còn hợp lệ, nên không trở lại khi public mở.

Đã sửa worker theo dõi policy liên tục: khởi động lại từ cache khi public mở, retry có khoảng nghỉ khi tải/start lỗi, dừng model để trả VRAM khi khóa. Xem riêng `.arena/llama.log` và `modelStage`, không quy mọi VRAM 0 về chưa download. Đã xác nhận model trên A40 khoảng 19,2 GiB VRAM và generate thật. Không khởi động worker hoặc tải GGUF cho Jupyter-only; LLM-only không khởi động Jupyter/tải dataset.

## 7. Build/image không đồng bộ hoặc ổ C: đầy

- Build local từng dừng I/O/ENOSPC; fasttext cũng từng thiếu `Python.h`. Base image cần `python3.10-dev`. Không lặp lại build CUDA nặng trên máy local đang thiếu dung lượng; dùng workflow GitHub Actions.
- Sửa Python runtime dùng `Dockerfile.runtime` và `COPY --link`, kế thừa digest dependency đã kiểm chứng, tránh pull/build lại toàn bộ dependency khi chỉ đổi lớp runtime. Nếu đổi Dockerfile đầy đủ/requirements, dùng full build và cập nhật digest nền.
- Image phải build/push thành công trước khi mở UI/API cần contract mới. Ghim digest trong env/template của **lần cấp mới**. Các digest Workspace cũ đã biết chưa hỗ trợ tách dịch vụ được chặn khi cấp LLM-only/Jupyter-only.
- Cập nhật template/env không tự cập nhật image Pod đang chạy. Muốn sửa Pod hiện có: xác nhận ID, kiểm tra kernel đang dùng, kiểm tra mount `/workspace`, chỉ PATCH trường cần đổi rồi restart có kiểm soát. Không reset/terminate để chữa readiness; không tự restart liên tục khi model đang tải.
- Ổ C: đầy còn làm **bộ duyệt tự động không khởi tạo được** (`os error 112`): action chưa chạy, không phải từ chối vì nguy hiểm. Không thử vòng qua approval; giải phóng đĩa rồi mới tiếp tục. Chỉ dọn cache QA đã xác định; không xóa dữ liệu cá nhân/dataset gốc/volume của đội.

## 8. Pod chung và chế độ dịch vụ: tránh regression

Pod cũ mặc định `scope=team`, `services=both`. Pod chung là một allocation cho mọi đội, không fan-out tạo từng Pod. Khóa cấp phát theo phạm vi/vòng/dịch vụ; giữ tương thích reservation cũ. Hai đội dùng trùng session ID vẫn phải có lịch sử/token tách biệt. Teamless hoặc người không còn là thành viên không được vào Pod chung. Jupyter chung thật sự chia sẻ tệp/kernel/GPU, phải ghi rõ trên UI.

## 9. RUNNING nhưng container lỗi `GPU requires reset` — 29/10/2026

- Log sự cố: image digest `f87f1337…` tải thành công, sau đó host lặp lỗi `error creating container: nvidia-smi ... ([GPU requires reset])` 14 lần. Lỗi xuất hiện trước khi agent/model chạy. Đây là lỗi GPU/driver trên host Runpod; sửa quota, image hoặc hàng đợi không reset được GPU vật lý.
- `desiredStatus=RUNNING` chỉ là trạng thái yêu cầu. Khi agent chưa phản hồi và Runpod chưa có runtime, web giữ trạng thái container chưa sẵn sàng. Đối soát đọc tối đa 20 dòng System Logs, 32 KiB và 2,5 giây, cache kiểm tra 60 giây; chỉ lưu mã chẩn đoán/thông báo cố định, không lưu/trả log hoặc credential.
- Khi có lỗi tạo container xác nhận, web báo “Lỗi khởi động Pod”; vẫn giữ allocation/reservation và ước tính phí của Pod đã cấp. Admin có thể dừng/thu hồi; không tự retry tạo thêm Pod. Trạng thái tự phục hồi khi agent trả health; cả Admin và thí sinh đang mở dashboard đều đối soát định kỳ.
- Với GPU cần reset: nhờ Runpod xử lý host, hoặc kiểm tra/sao lưu dữ liệu rồi thu hồi Pod lỗi và thêm Pod vào **nhóm hiện có**. Stop/start giữ host cũ, không đảm bảo sửa lỗi. Pod thành viên khác, lịch sử và quota nhóm được giữ nguyên. Không tạo GPU để QA.
- Tại lần đối soát sự cố này, Pod cũ đã bị thu hồi (Runpod 404, danh sách Pod rỗng); nhóm vẫn tồn tại, vòng chưa bắt đầu. Không diễn đạt việc sửa web thành đã khôi phục GPU thật.

Nguồn API: [System Logs SSE](https://docs.runpod.io/api-reference-v2/pods/stream-pod-logs), [vòng đời Pod và host](https://docs.runpod.io/pods/troubleshooting/zero-gpus).

## 10. Connect kẹt `still fetching image`, số layer thay đổi — 30/10/2026

- Sự cố thực tế: System Logs lặp `create container: still fetching image` hơn 20 phút; GraphQL yêu cầu RUNNING nhưng `runtime=null`, agent port 8000 trả 404, chưa có server team/kernel. Đây là bước pull image trên host, trước khi mã JupyterHub chạy. Chưa có log `no space left`, lỗi entrypoint hoặc lỗi CUDA; không tự kết luận container disk 30 GB bị đầy.
- Image Hub `179b5581…` có 26 layer, tổng khoảng 10,19 GiB nén. PyTorch chiếm khoảng 3,72 GiB và TensorFlow 2,49 GiB. Registry manifest hợp lệ và ba blob lớn trả HTTP 206 cho byte-range nhỏ; phép thử này chỉ chứng minh registry truy cập được từ máy kiểm tra, không chứng minh đường tải hay đĩa của host Runpod bình thường.
- Counter Connect từ `0/15` sang `0/8` không đủ để kết luận image đổi hoặc ứng dụng restart. Đối chiếu digest, System Logs, runtime và health có xác thực. Không lấy số layer hay trạng thái yêu cầu RUNNING làm readiness của Hub/Lab.
- Arena phân biệt trạng thái **Đang tải image Docker**, **Đang giải nén image Docker** và lỗi tạo container. Chỉ lưu enum chẩn đoán; không đưa raw log, tên registry riêng hay credential ra response. Chẩn đoán vẫn có giới hạn thời gian/byte và cache 60 giây; lỗi GPU reset/container được ưu tiên hơn tiến trình pull.
- Một lần restart và một lần stop/start cùng Pod đã được thực hiện trong sự cố này; mount `/workspace` 100 GB được kiểm tra giữ nguyên tại các thao tác đó. Stop/start chỉ thực hiện sau khi người dùng chấp nhận khả năng nhả GPU. Không tự tạo Pod khác hoặc terminate để thử. Sau đó audit có sự kiện delete và một allocation mới được tạo; phải đối soát lại ID hiện tại, không tiếp tục điều khiển ID cũ.
- Nếu host tiếp tục chỉ báo chờ pull mà không có tiến độ, cần Runpod kiểm tra image pull/Docker daemon/mạng/đĩa host. Chuẩn bị Pod ID, digest, thời điểm và log đã bỏ secret cho hỗ trợ. Sửa UI không sửa được hạ tầng pull image của nhà cung cấp.

## Mốc kiểm chứng và giới hạn

- Pod thật dùng để nghiệm thu ban đầu: `0fb95yqf1t0bka`. Không suy trạng thái hiện tại từ ghi chép này; luôn truy vấn lại trước thao tác.
- Đã thấy lỗi frontend `Shared module @jupyter-widgets/base ...` của một extension chưa xác định. Launcher/kernel cơ bản vẫn hoạt động; chưa kết luận các widget/extension EDA đều đã được kiểm thử. Không nhầm lỗi này với lỗi Origin 403 đã xác định.
- Test fake Runpod + Redis thật kiểm tra logic cấp phát/quyền/quota; không thay thế kiểm chứng CUDA, model, proxy và kernel thật. Build thành công không tự chứng minh runtime sẵn sàng.

Tham khảo: [GraphQL Pod operations](https://docs.runpod.io/sdks/graphql/manage-pods), [REST v1 → v2](https://docs.runpod.io/api-reference-v2/migrate-from-v1), [Jupyter Server security](https://jupyter-server.readthedocs.io/en/latest/operators/security.html), [Docker COPY --link](https://docs.docker.com/reference/dockerfile/#copy---link). Cách cấu hình hiện tại: [GPU_WORKSPACE.md](GPU_WORKSPACE.md).
