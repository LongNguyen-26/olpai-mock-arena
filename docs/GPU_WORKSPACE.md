# GPU Workspace — cấu hình luyện tập

Cập nhật 29/10/2026: xem [CHAT_QUEUE.md](CHAT_QUEUE.md) cho nhóm nhiều Pod, giao thức worker, quota tổng, template chung và trình tự reset/phát hành. Image mặc định cho Pod mới lấy từ env/template đã ghim digest; digest trong ghi chép triển khai cũ bên dưới không phải image hàng đợi mới.

Admin cấp một GPU mỗi Pod, chọn riêng một đội hoặc dùng chung cho tất cả đội. Mỗi Pod chạy cả hai dịch vụ, chỉ Chatbot DeepSeek 32B Q4, hoặc chỉ JupyterLab. Mặc định A40 48 GB; không yêu cầu chặn Internet/cấm pip ở tầng hệ thống.

Image task-root và không nạp dataset đã được [GitHub Actions build/push thành công](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40574925727), từ commit `06b3cb81658890db67cd59d628f6a774e692d075`. Digest của bản trước tính năng hàng đợi: `nguyenlong26/olpai-workspace@sha256:4510a9e0bfbb96ca83873df7535d61367b594d841387557b561df4ab5a5a94cf`. Các Pod đang chạy giữ nguyên image và volume.

## Pod chung, Pod riêng và loại dịch vụ

- Khi có JupyterLab, admin chọn **Nạp dataset của vòng đã chọn** hoặc **Không nạp dataset**. Vòng vẫn quyết định lịch/quyền truy cập; tùy chọn không nạp được lưu trên Pod và manifest không cấp URL dữ liệu public/private.
- Gói chuẩn hóa có `workspaceLayout: task-root`: giải nén thành `/workspace/Tac_vu_N/baseline.ipynb` và `dataset/{train,public_test,private_test}`. Private chỉ được cấp khi pha cho phép. ZIP tải về nằm trong `.arena/downloads` ẩn; runtime mới không tạo sẵn `data/` hoặc `Final/`. Gói/Pod cũ giữ cấu trúc cũ, không di chuyển hoặc xóa tệp đang dùng.
- Thông số GPU có nhãn VRAM, mức sử dụng và nhiệt độ khi có số liệu. Web đọc được telemetry CSV cũ; Pod mới gửi thêm nhiệt độ. Chi phí giữ ở từng Pod, thông tin khởi động chi tiết được thu gọn.

- Chọn **Riêng một đội** hoặc **Chung tất cả đội** trong form cấp phát. Pod chung là một tài nguyên duy nhất, không tạo một Pod cho mỗi đội; đội có Pod riêng vẫn thấy và dùng được Pod chung.
- Pod chung cấp quyền cho thành viên thật của mọi đội, kể cả đội tạo sau; không cần đăng ký riêng để nhận quyền chia sẻ này. Người chưa có đội không được truy cập. Pod riêng giữ yêu cầu đăng ký được duyệt. Cả hai vẫn theo lịch public/private của vòng đã chọn.
- **Chỉ Chatbot**: không khởi động Jupyter, không mở cổng 8888, không tải dataset. Model và ngân sách token theo template; lịch sử và quota phiên tách theo đội, kể cả khi các đội dùng trùng session ID. GPU xử lý một yêu cầu chat mỗi lần.
- **Chỉ JupyterLab**: không tải/nạp LLM, GPU dành cho notebook. Vẫn gắn lịch của vòng luyện; có thể nạp dataset hoặc mở notebook trống. Nếu nạp dữ liệu, public preload, private nạp khi mở private. Jupyter chung dùng chung tệp, kernel và GPU, không phải workspace tách biệt từng đội.
- Ngoài nhóm Chatbot, mỗi phạm vi/vòng có tối đa một Pod cung cấp từng dịch vụ: cho phép một Pod LLM và một Pod Jupyter riêng biệt; một Pod chạy cả hai giữ cả hai slot. Không tạo trùng khi bấm đồng thời hoặc mất xác nhận. Pod cũ mặc định riêng một đội/cả hai dịch vụ và giữ tương thích khóa cấp phát cũ.
- API deploy thêm `scope: team|all`, `services: both|llm|jupyter`, `loadDataset: boolean` (mặc định true); `teamId` chỉ bắt buộc với scope team. Runtime nhận `ARENA_WORKSPACE_SERVICES`, mặc định both để tương thích Pod cũ.

## Nguồn và phạm vi mô phỏng

[Thông báo chính thức OLP](https://www.olp.vn/tin-t%E1%BB%A9c/olympic-icpc/th%C3%B4ng-b%C3%A1o), mục 21h30 ngày 01/11/2025: LLM dùng trong 5 giờ đầu, không giới hạn session, tối đa 2.000 token chung input + output cho mỗi session. Đây là nguồn 2025, chưa phải xác nhận luật 2026. Web mặc định khóa chatbot khi chuyển khỏi public, kể cả mở private/kết thúc sớm. Vòng vô thời hạn giữ LLM tới khi chuyển pha.

Token dùng chính tokenizer/chat template của GGUF, bao gồm lịch sử gửi lại và token định dạng; reasoning tính vào output. Tổng input + output luôn cộng dồn theo phiên và bị chặn bởi trần tổng admin chỉnh được (mặc định 2.000). **Mỗi lượt** giới hạn thêm input/output từng prompt; **Mỗi phiên** giới hạn thêm input/output cộng dồn riêng. Không có quota tổng cả kỳ thi. `/usage`, `/limits`, `/help`, `/new` không gọi inference.

Lượt vượt giới hạn được lưu nhưng không inference, không trừ token và không đưa vào context lượt sau. Lịch sử gửi tới model được rút gọn theo các lượt cũ hoàn chỉnh để vừa ngân sách/context; transcript trên giao diện giữ nguyên. Ngân sách chỉ được reserve khi worker bắt đầu, hoàn output chưa dùng khi có kết quả chắc chắn; mất xác nhận giữ reservation để đối soát. Đây là chính sách Arena, không khẳng định luật thi chính thức.

Footer và `/limits` đọc quota hiện tại từ kho template chung; sửa quota áp dụng ở lượt bắt đầu tiếp theo, không cắt lượt đang chạy. Context cố định khi cấp Pod, mặc định `min(tổng phiên, input + output) + 128`; Pod cũ giữ cửa sổ đã cấp. Tăng quota không tự restart Pod.

Giao diện chat hỗ trợ công thức `$...$`, `$$...$$`, `\(...\)`, `\[...\]` và công thức LaTeX trong ngoặc vuông nguyên dòng của phản hồi cũ. Khối code giữ nguyên nội dung, có khung và nút sao chép; không diễn giải LaTeX bên trong code.

[Model gốc](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B) và [GGUF cộng đồng của bartowski](https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF): Q4_K_M khoảng 19,9 GB. Không khẳng định chất lượng tương đương BF16/cấu hình BTC. LLM và notebook tranh chấp VRAM/compute, không phân vùng GPU cứng; chưa benchmark A40 thực tế.

[Giá Runpod](https://www.runpod.io/pricing) đối chiếu 27/10/2026: A40 48 GB $0,59/h; RTX 6000 Ada 48 GB $0,99/h; A100 PCIe 80 GB $1,79/h. Sáu giờ A40 khoảng $3,54 tiền GPU, cộng lưu trữ/thuế; giá và tồn kho thay đổi. Web dùng [GraphQL quản lý Pod](https://docs.runpod.io/sdks/graphql/manage-pods), cùng mutation `podFindAndDeployOnDemand` như Python SDK GraphQL, và [catalog giá v2](https://docs.runpod.io/api-reference-v2/catalog/list-gpu-types), cache 60 giây. Template mặc định chọn Secure Cloud. Trần USD/h admin nhập áp dụng giá GPU báo từ catalog, không phải hard cap hóa đơn.

Đã xác minh trực tiếp ngày 27/10: A40 Community bị từ chối bằng GraphQL HTTP 200 với `errors[].extensions.code = SUPPLY_CONSTRAINT`; đây là hết tài nguyên, không phải yêu cầu đang chờ. A40 Secure cấp thành công ở $0,59/h. Host trong catalog báo CUDA 13.2; dùng `minCudaVersion: "12.8"` thay danh sách REST v1 cố định để không loại các host mới tương thích. Không tự thử lại hoặc đổi API/cloud sau timeout chưa rõ kết quả. Phản hồi lỗi GraphQL được chuyển thành thông báo an toàn, không đưa nội dung gốc/env/khóa ra UI.

## Build và publish image

Ưu tiên **GitHub Actions**, không cần Docker/GPU trên máy local. Workflow `.github/workflows/gpu-workspace-image.yml` chạy kiểm tra web + runtime Python 3.10, sau đó build CUDA image trên runner Linux và push Docker Hub. Các action được pin SHA, chỉ quyền đọc repo; secret không được chuyển vào Docker build. Không tải GGUF 19,9 GB trong CI; Pod tải sau khi được cấp.

1. Tạo Docker Hub access token có quyền Write cho `nguyenlong26/olpai-workspace`.
2. Thêm repository secret tên **`DOCKERHUB_TOKEN`** tại [GitHub → Secrets and variables → Actions](https://github.com/LongNguyen-26/olpai-mock-arena/settings/secrets/actions). Không gửi token qua chat.
3. Vào [GitHub Actions](https://github.com/LongNguyen-26/olpai-mock-arena/actions), chọn **GPU Workspace image** → Run workflow → `publish=true`, tag `2026.10.27`. Push thay đổi Dockerfile/workflow cũng kích hoạt. Pull request chỉ build/kiểm tra, không login/push image.
4. Lấy image digest trong Summary của job để lưu vào template admin. Thiếu secret sẽ dừng rõ ràng trước khi build image lớn; có thể chọn `publish=false` để chỉ kiểm tra build.

Runner được dọn các toolchain cài sẵn trên máy ảo dùng một lần, yêu cầu ít nhất 35 GB trống. Việc này không dọn file trên máy người dùng. Private repository cần đủ Actions minutes theo gói GitHub của chủ repo; kiểm tra quota trước khi chạy nhiều lần.

Lệnh local chỉ là phương án dự phòng:

Tại thư mục dự án, Docker engine cần Running và đủ khoảng 25–30 GB dung lượng trống:

```powershell
docker build --progress plain -t nguyenlong26/olpai-workspace:2026.10.27 -f gpu-workspace/Dockerfile gpu-workspace
docker push nguyenlong26/olpai-workspace:2026.10.27
```

Đăng nhập Docker Desktop/Docker Hub trên máy có quyền push repository, không gửi credential vào chat. Image cần public; bản hiện tại chưa cấu hình registry authentication cho image private. Sau push nên dùng `nguyenlong26/olpai-workspace@sha256:...` trong template.

Image dùng CUDA 12.8.1/cuDNN/Ubuntu 22.04, Python 3.10, PyTorch 2.8.0/cu128 và torchvision 0.23.0, Transformers 4.57.1/Hugging Face Hub 0.36.0 để khớp requirements của Bộ đề 01. Pod được lọc host hỗ trợ CUDA từ 12.8. Kernel TensorFlow 2.17.1 riêng tránh xung đột wheel CUDA. Thư viện còn lại ở `gpu-workspace/requirements.txt`. Phiên bản do môi trường luyện tập chọn, không phải lockfile chính thức BTC. AutoViz yêu cầu xgboost <1.7 nên pin 1.6.2. Các corpus spaCy/NLTK và pretrained theo luật từng bài cần chuẩn bị riêng.

Sửa Python runtime dùng `Dockerfile.runtime` kế thừa digest dependency đã kiểm chứng để tránh cài lại CUDA/PyTorch. CI tự dùng Dockerfile đầy đủ khi Dockerfile/requirements đổi; cũng có thể chọn `full_build` khi dispatch. Sau khi nâng dependency image, cập nhật digest nền trong Dockerfile.runtime.

Pod gắn với vòng luyện ổn định: reset vòng tự gắn sang run ID mới, giữ Pod/notebook và tách lịch sử token theo run. Agent theo dõi policy, tự khởi động lại DeepSeek khi public mở lại và trả VRAM khi khóa. Web chỉ bật nút khi đúng pha/quyền và dịch vụ đã sẵn sàng; uptime lấy từ telemetry Runpod và cập nhật từng giây. Jupyter kiểm tra trang `/lab` có xác thực và proxy `/api/status`; chỉ `/api/status` trả readiness tối thiểu không cần token cho Runpod, các API dữ liệu/kernel/terminal vẫn yêu cầu token.

llama.cpp pin b5046, commit đối chiếu `74d4f5b041ad837153b0e90fc864b8290e01d8d5`. Một slot inference, context theo template, model tải vào volume lần khởi động đầu. Jupyter và agent khởi động trước model; không tự chạy notebook/training.

GGUF pin revision `1dc8cf9ffa5dd333057ea1b09ccf4772d8726dec`. Khi private/kết thúc/đặt lại vòng, agent dừng llama.cpp để trả VRAM cho notebook ở lần kiểm tra chính sách tiếp theo (khoảng 20 giây cộng độ trễ mạng). Web chặn inference ngay theo thời gian server.

## Cấu hình server

Giữ Redis/Blob hiện có và thêm biến server-only:

| Biến | Ý nghĩa |
|---|---|
| `GPU_WORKSPACE_ENCRYPTION_KEY` | Base64 32 byte ngẫu nhiên, AES-256-GCM mã hóa API key và secret workspace; giữ ổn định qua deploy và sao lưu an toàn. |
| `GPU_WORKSPACE_PUBLIC_URL` | HTTPS origin công khai, agent Runpod truy cập được; không dùng localhost hoặc preview bị Vercel Authentication chặn. |
| `RUNPOD_WORKSPACE_IMAGE` | Image mặc định đã push; admin có thể chỉnh qua template. |

Không dùng `NEXT_PUBLIC_` cho secret. Tạo khóa trực tiếp vào file gitignored, không in ra log:

```powershell
node -e "require('fs').mkdirSync('.local',{recursive:true});require('fs').writeFileSync('.local/gpu-workspace-master.key',require('crypto').randomBytes(32).toString('base64'))"
```

Đưa giá trị vào Vercel Secret đúng environment. QA/development dùng khóa và namespace riêng. Không ghi đè `.env`/credential cũ. Runpod API key nhập UI admin, không truyền key này cho Pod.

## Vận hành

Trong UI quản trị, chọn **Dịch vụ trên Pod** trước khi chỉnh template. Mỗi chế độ (Chatbot + JupyterLab, Chỉ Chatbot, Chỉ JupyterLab) có bản nháp riêng. Template được lưu trong `gpu:templates:shared`; mọi admin được xem, dùng và sửa. Ghi đè kiểm tra revision/version để không làm mất thay đổi của admin khác. Credential Runpod và quyền điều khiển Pod vẫn riêng theo owner.

Chọn **Cấu hình mới** trong dropdown hoặc **Tạo bản sao**, nhập tên khác với các template đã lưu trong kho chung (chuẩn hóa Unicode, khoảng trắng và chữ hoa/thường). Ghi đè template có sẵn cần xác nhận; API kiểm tra revision để ngăn cửa sổ cũ ghi đè thay đổi mới. Nút “Nạp lại template đã lưu” bỏ bản nháp để lấy cấu hình đã lưu hiện tại. Poll không ghi đè bản nháp đang chỉnh.

Đổi GPU/cloud sẽ truy vấn [`gpuTypes.lowestPrice`](https://graphql-spec.runpod.io/) cho 1 GPU và tự điền `minMemory`/`minVcpu`. Đây là RAM hệ thống/vCPU theo offer, không phải VRAM; không bảo đảm tài nguyên host cuối cùng hoặc còn stock. Nếu không có thông số, form xóa số cũ và yêu cầu nhập thủ công. Response cũ đến muộn không ghi đè lựa chọn mới. Lưu template đúng chế độ trước khi cấp Pod; API kiểm tra dịch vụ. Phần cứng/image trong snapshot Pod không bị sửa khi lưu template.

Khi Pod đang chạy, admin có **Ẩn/Hiện metrics cho đội thi** ngay trên thẻ Pod; không có nút này trong phần chuẩn bị deploy. Admin luôn xem được metrics. Khi ẩn, thí sinh không thấy telemetry/uptime trên UI và cả API state/sync đều bỏ các trường đó. Quyền JupyterLab/Chatbot giữ theo lịch/quyền hiện có.

1. Admin vào GPU Workspace, lưu Runpod key; server kiểm tra list Pod trước khi lưu. Không đổi key khi còn Pod/yêu cầu đang hoạt động.
2. Cập nhật giá, chỉnh image/GPU/RAM/vCPU/disk/token và lưu template. Tạo bản sao để lưu biến thể cho đội khác.
3. Chọn đội do thí sinh đã tạo và dataset của một vòng đã phát hành; vòng đang xem được gợi ý. Một đội chỉ có một yêu cầu/Pod đang hoạt động, kể cả chuyển vòng.
4. Cấp GPU rồi Đối soát. Pod chạy khác với Jupyter/model/dataset sẵn sàng; UI hiển thị riêng và có thời điểm đối soát. Thí sinh tự đối soát Pod của mình mỗi 30 giây khi mở Workspace; admin đối soát từng Pod.
5. Thành viên đã được duyệt vòng mở Chatbot và JupyterLab trong tab mới. `/workspace/data/public`, `/workspace/data/private`; đầu ra ở `/workspace/Final/Tac_vu_1`, `/workspace/Final/Tac_vu_2`. Admin không cần tham gia đội.
6. Chat theo workspace/session, lịch sử TTL 30 ngày từ lượt gửi. Mỗi máy/tab mở lần đầu tạo UUID riêng và lưu trong sessionStorage theo Pod; refresh giữ phiên hiện tại. “Đoạn chat mới” hoặc `/new` đổi UUID của tab đó và bắt đầu lịch sử/ngân sách mới, không ảnh hưởng tab khác. ID mặc định cũ bằng Pod ID được thay bằng UUID. Token và quota được kiểm tra server, không tin lịch sử client.
7. Admin Dừng/Chạy lại/Thu hồi. Thu hồi xóa volume, cần tải source/trọng số/Final trước. Không tự dừng Pod khi hết giờ; đóng tab không tắt kernel hay ngừng phí.

## Dataset và private

Agent lấy manifest bằng secret riêng, preload public từ Drive (`gdown`) hoặc Blob signed URL, kiểm tra số byte/SHA-256, từ chối ZIP traversal/symlink. Chỉ đọc assets của package, không đưa judge/gold vào manifest. ZIP tự giải nén và giữ bản tải gốc; tar/gz/7z chỉ tải, không tự giải nén.

Private chưa tải plaintext trước giờ: chỉ có `PRIVATE_LOCKED.txt`. Server chỉ cấp link sau khi mở pha; agent kiểm tra mỗi 20 giây, tải/kiểm tra/giải nén rồi xóa ghi chú khóa. Không phải preload ZIP mã hóa rồi phát password. Drive public có thể bị người biết link chia sẻ ra ngoài; web không thu hồi bản đã tải.

Đặt lại vòng đổi run ID: manifest cũ vô hiệu, chatbot/link mở notebook từ web bị chặn. Phiên Jupyter đang mở và dữ liệu đã tải không thể thu hồi chỉ bằng web; nên thu hồi Pod cũ trước lượt mới. Chế độ luyện tập không ngăn người có terminal gọi model trực tiếp, sửa agent, giữ URL Jupyter, pip hoặc Internet. Không mô tả như sandbox thi khóa chặt.

## Chống trùng, chi phí và lỗi

- Redis giữ active record nguyên tử, không TTL, trước POST tạo Pod. Allocation ID/name duy nhất; timeout không retry POST. Hai máy/admin/HTTP retry không tạo Pod thứ hai cho cùng đội.
- Mất xác nhận: Chờ đối soát, tìm Pod qua tên. Không tự giải phóng khóa mơ hồ. Hủy yêu cầu lỗi chỉ khi Runpod từ chối rõ ràng và list Pod không thấy tên. Pending mơ hồ cần đối chiếu Runpod trước bảo trì thủ công, không xóa khóa để thử mù.
- Chi phí chỉ bắt đầu sau khi Runpod xác nhận Pod ID; yêu cầu thất bại/chờ đối soát chưa có Pod luôn hiển thị $0. Chi phí ước tính đơn giá × thời gian quan sát; khi thiếu rate dùng quote. Dừng dùng ước tính volume $0,20/GB/tháng / 730 giờ; có thể lệch invoice do độ trễ đồng bộ, storage/container disk, thuế hoặc thay đổi giá. [Giá lưu trữ](https://docs.runpod.io/pods/pricing).
- Hàng đợi Redis giữ một prompt mỗi session, tối đa bốn prompt chưa hoàn tất/đội/run; worker giữ một slot mỗi Pod. Prepare giữ token tối đa trước inference, complete hoàn phần output chưa dùng. Mất xác nhận sau prepare giữ ngân sách và chuyển uncertain để đối soát, không tự tái chạy. Kiểm tra lại pha/quyền tại transition và trước khi phát câu trả lời.
- Không log prompt, provider payload, key, môi trường Pod hay signed URL. DTO bỏ secret/owner ID. API key mã hóa trong Redis, chỉ backend giải mã.

## Kiểm tra

```powershell
npm run typecheck
npm test
npm run build
python gpu-workspace/test_agent.py -v
node --env-file=.env --import tsx scripts/qa-workspace-flow.ts
```

Script cuối tạo/dọn namespace `arena:qa:gpu:<uuid>` trên Redis; Runpod/Pod HTTP giả lập, không cấp GPU tính phí. `--keep` giữ fixture UI trong `.local/gpu-qa.json`, cần dọn sau kiểm tra. Python kiểm tra CPU/ASGI/ZIP, không chứng minh CUDA/model. Nghiệm thu thật cần admin cấp A40 và xác nhận model/tokenizer, hai kernel, dataset và inference trên GPU thực tế.
