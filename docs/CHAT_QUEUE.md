# Chatbot: hàng đợi, nhóm Pod và template chung

Thí sinh gửi prompt như tin nhắn bình thường và nhận câu trả lời khi hoàn tất. Không hiện trạng thái request, hiệu ứng suy luận, vị trí hàng, ETA hay nút hủy. Việc gửi tiếp/tạo chat mới bị khóa trong session đó cho tới khi request hoàn tất; ô nhập vẫn giữ bản nháp. Tab khác dùng UUID khác. Refresh giữ session; outbox trong sessionStorage retry cùng request ID nếu mất ACK. Đóng tab không hủy inference.

## Điều phối

- Mỗi đội tối đa bốn request chưa hoàn tất trong cùng run, cộng qua Pod riêng và nhóm. Admin dùng lane riêng theo tài khoản. Mỗi session một request; FIFO trong đội và round-robin giữa đội.
- `POST /api/workspace/chat` nhận `id` hoặc `groupId`, `session`, `requestId`, `content`, và `runId` của trang; trả 202. GET dùng cùng target/session để đồng bộ. Không có API hủy dành cho thí sinh.
- Agent chủ động POST `worker/{claim,prepare,heartbeat,complete,fail}` với bearer của workspace. Endpoint worker không dùng cookie/Origin; các thao tác browser vẫn kiểm tra Origin và quyền server. Redis credential chỉ ở web.
- Một GPU/Pod, chọn 1/2/4/8 slot inference trên template trước khi cấp. Preset Chỉ Chatbot mới là 4; preset dùng chung Jupyter và record cũ thiếu trường là 1. Worker giao thức 1 vẫn phục vụ một slot, giao thức 2 có slot ID/capacity được server đối chiếu với bản chụp allocation. Heartbeat 10 giây, lease 45 giây; runtime mới có inference timeout 600 giây, tách khỏi thời gian chờ hàng.
- Model chỉ nạp một lần mỗi GPU, dùng continuous batching. `ARENA_CONTEXT_SIZE` vẫn là context mỗi request; runtime cấp tổng context bằng giá trị đó nhân `ARENA_LLM_PARALLEL` và kiểm tra context thực tế từng slot trước khi báo ready. Tăng parallel không thay quota của thí sinh.
- Claim hết lease trước prepare được xếp lại; attempt/slot cũ bị chặn. Sau prepare, hết lease thành uncertain, không tự inference lại. `.arena/chat-jobs/slot-N.json` lưu riêng kết quả/ý định từng slot trên volume; restart chỉ gửi lại kết quả hoặc báo thất bại. Journal cũ `.arena/chat-job.json` được tiếp nhận ở slot 0. Callback lặp không ghi thêm câu trả lời hoặc tính thêm token.
- Timeout/mất xác nhận với engine giữ slot chờ đối soát. Agent chỉ báo thất bại/nhận việc khác khi probe nội bộ xác nhận slot đã rảnh hoặc tiến trình engine đã dừng; không restart model và làm mất các lượt khác chỉ vì một request lỗi. `/slots` và `/metrics` chỉ mở trên localhost 8080, không proxy ra Internet.
- Redis đối soát tối đa 256 job trong một script nguyên tử thay vì một lượt HTTP/clock cho mỗi job. Mỗi slot claim riêng vẫn giữ FIFO trong đội và luân phiên giữa các đội.
- Nếu không còn worker sẵn sàng liên tục ba phút, request chưa bắt đầu được chốt lỗi để người dùng có thể gửi lại. Không hủy inference vì request khác đến hoặc vì tab đóng.
- Kiểm tra quyền, thành viên, run và pha ngay tại transition. Private/ẩn/xóa/reset vòng chặn kết quả muộn; agent giải phóng model khi policy khóa hoặc hết hạn. Kết nối control plane lỗi ngắn không dừng model khi policy còn hiệu lực.

## Admin

Chọn **Chỉ Chatbot**, vòng/phạm vi và template; tạo nhóm rồi cấp từng Pod. Chọn lại nhóm trong form để **Thêm một Pod vào nhóm**. Mỗi allocation có UUID, retry giữ UUID và tên Pod; kết quả tạo Pod chưa rõ phải đối soát trước khi thêm tiếp. Một allocation lỗi không thu hồi các Pod còn lại.

Nhóm giữ một reservation LLM cho phạm vi/vòng, chứa nhiều workspace. Nhóm do admin tạo quản lý, chỉ chứa Pod của admin đó; các admin khác xem được. Template chung không chia sẻ API key. Nhóm cố định image/model/context, chỉ các trường quota cập nhật từ template. Worker khác image/context/model fingerprint bị chặn; không suy model sẵn sàng từ Runpod RUNNING.

Nhóm chung mở cho mọi đội có thành viên, không yêu cầu đăng ký vòng; nhóm riêng vẫn kiểm tra đăng ký. Lịch sử nhóm có khóa group/run/team/session, không gắn với Pod. Thí sinh chỉ thấy một nút Chatbot của nhóm.

Admin thấy readiness, số lượt chạy/chờ, lượt chờ lâu nhất, heartbeat và tổng chi phí thành viên. **Tạm ngừng nhận prompt mới** giữ công việc đã nhận. **Ngừng giao việc mới** cho Pod để hoàn tất inference trước khi dừng. Lệnh stop/terminate đang có việc sẽ bật drain và yêu cầu đối soát/chờ xong trước.

Admin có lựa chọn **Lượt xử lý đồng thời / GPU** trong template. Lưu chỉ áp dụng cho Pod mới; Pod/nhóm đang chạy không tự đổi image/context/capacity. Hai Pod bốn slot có tổng capacity tám khi model và cả hai worker sẵn sàng; request vượt capacity chờ hàng, không tạo thêm bản sao model. Thống kê nhóm hiển thị capacity sẵn sàng và thao tác từng Pod hiển thị số slot; worker cũ hiển thị một slot. Stop/terminate đặt drain trước khi đọc tất cả slot để không nhận thêm claim trong lúc kiểm tra.

Nâng cấp này chỉ xử lý chatbot đồng thời. Chức năng deploy manual/nhận Pod ngoài đang hoãn, chưa có endpoint hoặc UI cho luồng đó.

Request uncertain hiển thị trong Admin để đối chiếu Pod/journal. Sau đối soát có thể **Chốt thất bại**, giữ ngân sách đã reserve; callback đến sau quyết định này bị chặn. Không tự hoàn token hoặc tự chạy lại việc có thể đã inference. Đóng nhóm chỉ khi Pod đã thu hồi và không còn request.

## Template và token

Kho chính là `gpu:templates:shared`, có revision và người/thời điểm tạo/sửa. Mọi admin dùng và chỉnh được; update đồng thời kiểm tra version/revision để không mất thay đổi. Trước migration, code còn đọc kho cũ để tương thích rollout.

Trần tổng phiên luôn áp dụng: mặc định 2.000, admin sửa 256–16.384. Theo lượt: input/output có trần mỗi request. Theo phiên: input/output có trần cộng dồn riêng. Cả hai vẫn bị chặn bởi tổng input + output. Lịch sử gửi lại tính vào input; reasoning tính vào output. Footer và /usage luôn hiển thị tổng.

Request chưa chạy không tiêu token; prepare reserve input + output tối đa, complete hoàn phần output chưa dùng. Kết quả chưa xác nhận giữ reservation. Prompt bị từ chối trước inference không tiêu token và được đánh dấu loại khỏi context tiếp theo. Quota sửa mới áp dụng ở prepare tiếp theo, không cắt lượt đang chạy. Context cố định khi cấp Pod; tăng quota không tự restart Pod.

## Reset và phát hành

1. Chạy typecheck, test, build, Python test; chạy hai bộ QA Redis bên dưới trong namespace ngẫu nhiên. Browser QA dùng fixture riêng và mock provider. Không cấp GPU thật để QA.
2. Push commit đã kiểm tra; chờ GitHub Actions publish image của đúng SHA. Lấy digest, đồng bộ `RUNPOD_WORKSPACE_IMAGE` production và redeploy đúng commit sau thay env. Không sửa Pod hiện có.
3. Dry-run `npx tsx --env-file=.env scripts/reset-shared-templates.ts --image=nguyenlong26/olpai-workspace@sha256:...`. Xem bộ preset và backup `.local/template-backups/`.
4. Áp dụng bằng cùng lệnh thêm `--apply --production`. Migration sao lưu kho cũ trong Redis trước khi reset, tạo ID mới cho ba preset A40/both, A40/llm, A5000/jupyter. Chạy lại không reset tiếp hoặc ghi đè chỉnh sửa mới. Snapshot Pod và lịch sử cũ giữ nguyên.
5. Cần khôi phục: kiểm tra backup rồi chạy script với `--restore --apply --production`. Đây là khôi phục toàn kho template tại thời điểm reset; xem xét các chỉnh sửa mới trước khi chạy.

## Kiểm tra

```
npm run typecheck
npm test
npm run build
python gpu-workspace/test_agent.py -q
npx tsx --env-file=.env scripts/qa-workspace-flow.ts
npx tsx --env-file=.env scripts/qa-chat-queue.ts
```

Python test chỉ kiểm tra CPU. QA dùng Redis thật, provider/model giả lập, tự dọn namespace của lần chạy. `qa-chat-queue.ts --keep` lưu `.local/gpu-qa.json` cho HTTP/browser; dọn bằng `qa-workspace-cleanup.ts`. Không coi burst 28 request giả lập là đo throughput GPU. Dùng script benchmark với tài khoản/nhóm do admin chuẩn bị để đo 14/28 request thực tế; thử drain/mất một worker trong lượt đo riêng, không tự cấp hoặc dừng Pod đang dùng.
