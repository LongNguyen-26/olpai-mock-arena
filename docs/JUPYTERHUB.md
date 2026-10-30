# JupyterHub: nhiều team trên một Runpod Pod

Arena hỗ trợ chế độ `team-hub` cho Pod **Jupyter-only**. Mỗi team có một tài khoản Linux, home, server Lab, kernel và terminal riêng. Hai máy cùng team dùng cùng server và sửa notebook đồng thời. GPU dùng chung; không chia cứng VRAM và không chặn CUDA bằng hàng đợi.

Image Hub đã qua [CI Linux và publish](https://github.com/LongNguyen-26/olpai-mock-arena/actions/runs/41004156324), từ mã runtime `d8695f7b99b102d84824b4b310b9fe3f65ba854d`. Dùng image bất biến sau cho Pod mới:

```text
nguyenlong26/olpai-workspace@sha256:5691a3d185f474eec536a49417717c5a91a16011949024d18a9f5b342b129740
```

Ghim cùng digest trong `RUNPOD_HUB_IMAGE` và `RUNPOD_WORKSPACE_IMAGE`; web từ chối image Hub không nằm trong allowlist. Tag tiện tra cứu là `2026.10.30-hub`. `Dockerfile.runtime` kế thừa image dependency đầy đủ đã xác minh; chỉ rebuild CUDA/dependency khi các dependency thay đổi.

Các image Hub cũ đến `fd544272…` được thay bằng layout lưu trữ v2: control/secret ở đĩa cục bộ riêng, checkpoint mã hóa trên volume. Log `(20)` xác nhận volume ép thư mục root thành `0777`, nên chỉ tạo lại/chmod không đủ. Chi tiết lịch sử ở [RUNPOD_TROUBLESHOOTING.md](RUNPOD_TROUBLESHOOTING.md).

Refresh Arena, chọn lại template **JupyterHub** cho dịch vụ **Chỉ JupyterLab**, rồi cấp **Pod/volume mới**. Không tự thay image Pod cũ hoặc tự chuyển volume layout cũ. Kết quả CI không thay thế nghiệm thu kernel/WebSocket/CUDA trên Runpod thật.

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

Log Runpod đã xác nhận thư mục do root tạo trên volume vẫn có mode `0777`, kể cả sau yêu cầu `0700`. Vì vậy Hub không lưu bản rõ của control/secret trong `/workspace/.arena` nữa:

| Dữ liệu | Vị trí | Bảo vệ |
|---|---|---|
| Database, mapping, policy và các khóa Hub đang dùng | `/run/arena-hub/control` trên đĩa cục bộ | Root, thư mục `0700`; khóa `0600` |
| Checkpoint bền vững của Hub | `/workspace/.arena-hub-state-v1.enc` | AES-GCM xác thực, ràng buộc workspace và credential của agent |
| Home, venv, notebook và checkpoint của team | `/workspace/teams/<team-id>` | UID/GID riêng, home `0700` khi hoạt động |
| Dataset đã công bố | `/workspace/datasets/<sha256>` | UID dữ liệu riêng `62000`, thư mục `0755`, tệp `0444` |
| Staging, marker khởi tạo và cache tải | `/workspace/.arena-assets-v2` | UID dữ liệu `62000`, thư mục `0700` |

Checkpoint Hub được ghi mỗi 10 giây và khi dừng bình thường; dùng bản backup SQLite nhất quán. Notebook/venv vẫn ghi trực tiếp trên volume, không phụ thuộc chu kỳ checkpoint Hub. Khi mất đĩa cục bộ, runtime giải mã checkpoint để giữ khóa, UID và database; policy/URL tải không được khôi phục từ checkpoint cũ mà phải lấy lại từ Arena. PID cũ bị bỏ để không nhận nhầm tiến trình sau restart. Mất điện có thể mất vài giây metadata Hub gần nhất; UID được đối chiếu với ownership và marker của home để giữ đúng dữ liệu team.

Credential agent hiện có được dùng để dẫn xuất khóa checkpoint; không cần thêm khóa do admin nhập. Không đổi token agent, chép ciphertext sang hồ sơ khác hoặc gắn volume Hub cũ vào allocation khác. Checkpoint bị sửa, sai binding hoặc bị mất khi đã có home sẽ gây lỗi, không tự tạo đè khóa hay xóa bài. Volume từ layout cũ cần được xử lý riêng; bản nâng cấp này dùng Pod/volume mới theo quy trình nghiệm thu.

Dataset được tải, kiểm checksum và giải nén dưới UID dữ liệu, không nhận credential Hub/Runpod. UID này có HOME/cache cookie Drive riêng. Sau khi Arena xác nhận lại quyền pha, dữ liệu được công bố chỉ đọc, ưu tiên hardlink khi cùng owner/filesystem; cache tải được dọn sau khi công bố thành công. Team nhận bản starter riêng và liên kết dataset, không ghi đè bài làm đã có.

Home mới được tạo bằng UID team trong staging riêng trên cùng volume. Thư mục còn trống được chuyển tới vị trí cuối, khóa thành `0700` và kiểm tra không có tệp chèn trước khi tạo venv/notebook. Marker khởi tạo nằm ngoài home, chỉ UID dữ liệu ghi được. Runtime kiểm tra volume thực thi quyền của UID không phải root; nếu cả các UID này cũng bị ép `0777`, runtime từ chối thay vì cho các team dùng home công khai. Notebook không nhận token agent, khóa checkpoint, token điều khiển Hub hoặc credential Runpod. Chỉ file descriptor đọc của đúng starter/kernel được chuyển cho tiến trình ghi của team.

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
