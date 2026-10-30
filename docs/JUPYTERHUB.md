# JupyterHub: nhiều team trên một Runpod Pod

Arena hỗ trợ chế độ `team-hub` cho Pod **Jupyter-only**. Mỗi team có một tài khoản Linux, home, server Lab, kernel và terminal riêng. Hai máy cùng team dùng cùng server và sửa notebook đồng thời. GPU dùng chung; không chia cứng VRAM và không chặn CUDA bằng hàng đợi.

Image Hub đã qua [CI Linux và publish](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/40994198052), từ mã runtime `e3acddc7a6c16858980fa9e53afd0a34ffc4ff87`. Dùng image bất biến sau cho Pod mới:

```text
nguyenlong26/olpai-workspace@sha256:0ca70c5f5558e586f7ff232e912b58fcaeef7f68601fdeb68f17847fdd89c902
```

Ghim cùng digest trong `RUNPOD_HUB_IMAGE` và `RUNPOD_WORKSPACE_IMAGE`; web từ chối image Hub không nằm trong allowlist. Tag tiện tra cứu là `2026.10.30-hub`. `Dockerfile.runtime` kế thừa image dependency đầy đủ đã xác minh; chỉ rebuild CUDA/dependency khi các dependency thay đổi.

Image `179b5581…` có lỗi `ModuleNotFoundError: No module named 'hub_auth'` khi Hub đọc cấu hình, làm container khởi động lại trước khi tạo server team. Bản sửa thêm đường dẫn module quản trị `/opt/arena` ngay trong cấu hình Hub. CI hiện khởi động Hub từ thư mục khác và bỏ `PYTHONPATH`, đúng điều kiện đã làm lộ lỗi trên Pod thật. Pod đang dùng image cũ cần được quản trị xử lý riêng, giữ volume và kiểm tra kernel trước khi thay image.

Image `75434bdf…` sửa lỗi import nhưng vẫn tạo home bằng root rồi chown, thất bại trên volume NFS có UID remapping của Pod đã nghiệm thu. Image `5141126f…` ghi tệp trực tiếp dưới UID team, như phần lưu trữ bên dưới. Sau khi cập nhật web/template, refresh Arena và chọn lại template đã lưu trước khi cấp Pod mới.

Image `5141126f…` còn gặp lỗi Hub từ chối quyền tệp cookie trên volume NFS trong log người dùng mới gửi. Bản hiện tại `0ca70c5f…` giữ khóa bền vững nhưng dùng bản cookie có quyền nghiêm ngặt trên filesystem cục bộ; không bỏ kiểm tra quyền của Hub. Chọn template **JupyterHub** dành cho dịch vụ **Chỉ JupyterLab** trước khi cấp Pod mới.

Nếu Arena dùng nhiều tên miền, cấu hình `GPU_WORKSPACE_LOGIN_ORIGINS` bằng danh sách HTTPS origin chính xác, cách nhau bằng dấu phẩy. Địa chỉ của `GPU_WORKSPACE_PUBLIC_URL` được cho phép sẵn. Hub đăng nhập qua đúng tên miền người dùng đang mở để giữ phiên Arena; callback đổi ticket vẫn dùng control URL cố định.

## Cấp Pod tự động

1. Kết nối Runpod bằng API key của admin trong GPU Workspace.
2. Chọn **Chỉ JupyterLab**, tạo/lấy template **JupyterHub — workspace riêng từng team**. Chọn GPU, RAM, vCPU và storage theo offer thực tế; không coi VRAM là RAM hệ thống.
3. Lưu template với image Hub đã xác nhận. Mặc định tối đa 7 server team hoạt động, 2 server khởi động đồng thời.
4. Chọn vòng, có nạp dataset hay không, và những team được duyệt ban đầu. Danh sách được phép để trống.
5. Chọn **Arena cấp Pod qua Runpod API**, kiểm tra mức USD/giờ rồi cấp một Pod.
6. Chờ đối soát provider và Hub. RUNNING không tự chứng minh Lab/kernel/WebSocket đã dùng được.

Mỗi Pod chỉ có một ledger chi phí. Chi phí không nhân theo số team. Pod Chatbot tiếp tục hoạt động riêng.

## Deploy Runpod thủ công

1. Chọn cùng cấu hình trên nhưng đổi **Cách cấp Pod** sang chuẩn bị deploy thủ công.
2. Bấm **Chuẩn bị deploy manual**. Bước này giữ reservation trong Arena, không gọi API thuê GPU.
3. Trên thẻ hồ sơ, mở **Xem cấu hình deploy manual**. Cấu hình có token riêng của hồ sơ: chỉ admin sở hữu được xem, không chia sẻ hoặc chép vào template public.
4. Trong Runpod Console, dùng đúng image digest, tên Pod, storage mount `/workspace`, hai cổng HTTP `8888` và `8000`, cùng các biến môi trường đã sinh. Giữ entrypoint của image; không bật lệnh Jupyter/SSH của template PyTorch.
5. Sau khi deploy, nhập Pod ID rồi **Kiểm tra Pod**. Arena xác minh tài khoản Runpod, image, runtime identity, protocol và dịch vụ Jupyter-only.
6. Bấm **Gắn Pod**. Chỉ sau khi gắn thành công, agent mới được cấp manifest để tải dataset và phục vụ team.

Không nhận Pod PyTorch bất kỳ hoặc Pod có Chatbot. Không sửa image/token, restart hay cài agent lên Pod đang dùng. Không chuyển một volume đã gắn ở hồ sơ khác sang team mới bằng thao tác attach.

**Hủy hồ sơ** chỉ hủy hồ sơ chưa gắn. **Gỡ liên kết Arena** giữ Pod và dữ liệu trên Runpod; Pod có thể vẫn chạy và tính phí. Chi phí Arena bắt đầu ước tính khi xác nhận gắn, không bao gồm thời gian bạn đã thuê trước đó. Kiểm tra Billing của Runpod để biết phí thực tế.

## Thêm team và sử dụng hằng ngày

- Admin thêm team đã được duyệt ngay trên thẻ Hub, không deploy hoặc restart Pod.
- Thành viên đăng nhập Arena, mở workspace của đội. Server chỉ khởi động khi có yêu cầu; máy thứ hai vào cùng server.
- Mở notebook từ file browser của Hub để hai máy vào cùng tài liệu cộng tác. Đường dẫn notebook tự ghép theo kiểu cũ có thể mở chế độ không cộng tác.
- Nếu thiếu 4 GiB RAM khả dụng, thiếu 2 GiB đĩa trống hoặc hết chỗ hoạt động, workspace mới chờ và thử lại. Các server đang chạy được giữ. Đây là admission check, không phải quota bảo đảm.
- **Dừng workspace** ngắt server/kernel và tiến trình của UID team đó, giữ home/venv. **Thu hồi quyền** ngăn đăng nhập mới và yêu cầu dừng server của team.
- **Dừng Pod** ảnh hưởng mọi team. Volume disk giữ dữ liệu qua stop/start nhưng bị xóa khi terminate. Tải bản sao bài làm trước khi thu hồi Pod.
- Không tự cull server nhàn rỗi, mở Pod khác hoặc chuyển team sang máy khác. Đóng tab không dừng kernel hoặc giảm phí.

## Tệp, thư viện và dataset

Home của team ở `/workspace/teams/<team-id>`, quyền `0700`, UID/GID ổn định được lưu trên volume. Cấu hình, database, cookie secret và mapping tài khoản Hub ở `.arena/hub`, chỉ root đọc được. Notebook không nhận token agent, token điều khiển Hub hay credential Runpod.

Khóa cookie gốc được giữ trên volume qua restart; bản dùng lúc chạy nằm ở `/run/arena-hub/cookie-secret` trên đĩa cục bộ, thư mục `0700`, tệp `0600`, cùng giá trị khóa. JupyterHub vẫn kiểm tra quyền tệp như bình thường. Cách này tránh lỗi Hub từ chối tệp cookie trên một số volume NFS báo quyền file quá rộng. Runtime xác minh thư mục điều khiển do root sở hữu và có quyền `0700`, không theo symlink, không đưa khóa vào biến môi trường notebook, và từ chối tự xoay khóa nếu bản lưu bị hỏng.

Runpod có thể dùng NFS với UID container được ánh xạ sang UID host. Trong trường hợp này, root trong container không đổi được chủ tệp trên volume và cũng có thể không đọc được home `0700` của team. Runtime tạo home bằng UID team trong staging kín dưới `.arena`, rồi công bố bằng rename; các thao tác tạo thư mục, chép notebook/kernel và kiểm tra venv cũng chạy bằng UID đó. Nguồn được mở bởi quản trị và chỉ truyền file descriptor đọc cho tiến trình ghi. Không nới quyền home thành thư mục dùng chung. Home root sở hữu còn trống do lỗi khởi tạo cũ được tạo lại; home sai chủ đã có tệp được giữ và báo quản trị xử lý.

Kernel `pytorch` và alias `python3` dùng `.venvs/pytorch` trong home team, kế thừa bộ thư viện nền chỉ đọc. Terminal cũng ưu tiên Python/pip của venv này. Kiểm tra trước khi cài:

```python
import sys
print(sys.executable)  # .../teams/<team-id>/.venvs/pytorch/bin/python
```

`%pip install ...` thay đổi môi trường của riêng team; có thể cần restart kernel team đó. Không cấp sudo. Kernel TensorFlow có sẵn vẫn dùng dependency environment riêng của image.

Dataset tải và xác minh checksum một lần, lưu cache theo SHA-256. Bản công bố chỉ đọc dùng hardlink khi filesystem hỗ trợ, tránh nhân dữ liệu theo team; fallback copy khi cần. Notebook/code ban đầu được chép riêng và không ghi đè tệp đã có. Checkpoint và dữ liệu tự xử lý lưu vào thư mục riêng có quyền ghi.

Private chỉ tải/công bố khi manifest từ Arena cho phép. Agent kiểm tra lại quyền sau download dài; không chỉ dựa vào URL cũ. Các thao tác ghi vào home dùng directory FD và `O_NOFOLLOW` để không đi theo symlink do team đổi.

## GPU và ranh giới bảo vệ

**Xin lượt / Bắt đầu dùng / Trả lượt / Hủy đăng ký** là bảng tự quản, cho phép nhiều team đánh dấu đang chạy. Metrics VRAM/utilization là số đo toàn GPU; danh sách dùng GPU là tự khai báo. Trả lượt không tự dừng job hoặc giải phóng VRAM.

LocalProcessSpawner không cưỡng chế quota CPU/RAM. Một team vẫn có thể dùng quá nhiều RAM, GPU hoặc đĩa. Đây là môi trường luyện nội bộ trên một Pod/common browser origin, không phải sandbox cho các bên thù địch hoặc cô lập lỗi GPU bằng MIG.

Arena kiểm tra quyền khi khởi động và đổi ticket đăng nhập. Ticket dùng một lần, hạn 60 giây, gắn với người dùng/team/Pod/run/epoch và nonce trình duyệt. Hub/proxy API nội bộ chỉ nghe localhost; port 8888 giữ auth/XSRF và Origin đúng Pod, chỉ probe `/api/status` công khai tối thiểu.

Reset kể cả giữ BXH vô hiệu ticket và bảng lượt GPU cũ. Bài làm được giữ; private đã tải không thể trở lại bí mật. Khóa quyền mở Jupyter theo lịch không tự ngắt tab/kernel đang chạy. Muốn buổi luyện sạch, dùng Pod mới.

## Kiểm chứng

```text
npm run typecheck
npm test
npm run build
python gpu-workspace/test_agent.py -q
npx tsx --env-file=.env scripts/qa-workspace-flow.ts
npx tsx --env-file=.env scripts/qa-hub-flow.ts
```

Các script Redis tự dùng namespace QA mới và dọn đúng namespace đó; Runpod/runtime được stub, không thuê GPU. Dùng Python 3.10 của image để kiểm tra runtime.

Job CI `hub-linux` chạy trên Linux dùng UID thật, home riêng, shared data chỉ đọc, thêm team động, SSO giả lập cục bộ và Chromium thật để kiểm tra cộng tác/kernel. Job này không kiểm tra CUDA hoặc proxy Runpod. Phần đó nghiệm thu trên Pod do người dùng cấp: trước với hai team, thử chạy hai phép CUDA nhỏ đồng thời, rồi thêm team và mở dần tới bảy team.

### Nghiệm thu Pod đầu tiên

1. Cấp một Pod bằng template Hub mới với hai team. Đợi Hub sẵn sàng và mở Lab từ Arena trên hai máy của team A, một máy của team B.
2. Team A mở notebook từ file browser, sửa một cell ở mỗi máy rồi chạy; cả hai máy phải thấy nội dung và kết quả. Refresh để kiểm tra lưu tệp. Team B có home và notebook riêng.
3. Từ mỗi team, chạy cell nhỏ sau; giữ nguyên auth/Origin nếu gặp lỗi WebSocket và gửi trạng thái/log đã bỏ token cho quản trị viên.

```python
import os, sys, torch
print("uid", os.geteuid(), "python", sys.executable)
assert os.geteuid() != 0 and ".venvs/pytorch" in sys.prefix
assert torch.cuda.is_available()
x = torch.randn(1024, 1024, device="cuda")
y = x @ x
torch.cuda.synchronize()
print(torch.cuda.get_device_name(), "allocated MiB", torch.cuda.memory_allocated() / 2**20)
```

4. Chạy hai team gần nhau, kiểm tra metrics GPU chung và bảng lượt tự khai báo. Xóa biến/đóng kernel khi xong; nút Trả lượt không tự trả VRAM.
5. Thêm team thứ ba khi hai team đang dùng. Dừng/chạy lại riêng một workspace và kiểm tra tệp/venv còn nguyên. Chỉ thử stop/start toàn Pod sau khi các team đã lưu bài; thao tác này ảnh hưởng tất cả team.

Cell trên chỉ kiểm tra CUDA nhỏ, không phải benchmark throughput hoặc bằng chứng bảy team có thể training đồng thời.

Pod/image cũ mặc định `single`; không tự chuyển sang Hub hoặc thay dữ liệu đang dùng.
