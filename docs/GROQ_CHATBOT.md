# Chatbot Groq

Admin vào **GPU Workspace → Nhà cung cấp khi cấp phát → Groq**, nhập API key của chính mình và chọn **Kiểm tra và lưu khóa**. Thao tác kiểm tra chỉ đọc danh sách model; không gọi inference. Khóa lưu dưới dạng AES-256-GCM trong bảng riêng `arena.api_credentials`, dùng khóa mã hóa server hiện có. Không gửi khóa vào chat, Git, notebook hay biến `NEXT_PUBLIC_`.

Chọn model từ **Làm mới model**, tên chatbot, vòng luyện và phạm vi riêng một đội/chung tất cả đội. Đặt ngân sách token, lượt đồng thời và trần lượt/phút rồi cấp Chatbot. Mỗi cấu hình gắn cố định provider/model. Cần đổi model/provider thì tạm ngừng, chờ/đối soát request, đóng cấu hình cũ và cấp cấu hình mới; lịch sử cũ không bị chuyển sang model khác. Một dịch vụ Chatbot trên mỗi phạm vi/vòng; Pod `both` cũng giữ reservation Chatbot đó. Groq dùng song song được với Pod Jupyter-only.

Mỗi admin quản lý khóa của chính mình. Admin khác có thể xem nhóm nhưng không dùng khóa, điều khiển hoặc đối soát nhóm của chủ sở hữu. Trước khi thay/xóa khóa: tạm ngừng mọi chatbot Groq của mình và chờ các job hoàn tất, kể cả job cần đối soát. Nếu chủ sở hữu mất quyền admin hoặc khóa bị xóa, chatbot ngừng nhận prompt. Khóa mới cần quyền dùng model tương ứng trên Groq.

## Hội thoại và token

- Giao diện chat và quyền theo đội, đăng ký, vòng/run, public/private dùng chung với Runpod. Nhóm chung yêu cầu thành viên đội nhưng không yêu cầu đăng ký; nhóm riêng yêu cầu đăng ký được duyệt. Mỗi tab có UUID trong sessionStorage; refresh giữ phiên, chat mới hoặc `/new` đổi phiên.
- Input gồm lịch sử thực sự gửi tới model; reasoning tính trong output do Groq báo. Trước inference, giữ ngân sách bảo thủ theo byte UTF-8 cộng overhead định dạng; đây **không phải** tokenizer chính xác. Khi có phản hồi hợp lệ, chốt bằng `usage.prompt_tokens` và `usage.completion_tokens`, hoàn phần giữ dư. Các lượt cũ hoàn chỉnh có thể được lược khỏi context để vừa input budget; transcript hiển thị giữ nguyên. Ngưỡng bảo thủ có thể từ chối một prompt dù số token thực tế sẽ nhỏ hơn.
- Mỗi session một prompt đang xử lý; mỗi đội tối đa bốn prompt chưa hoàn tất trong cùng run, tính cả Runpod/Groq. Hàng đợi FIFO trong đội, luân phiên giữa đội. Đồng thời API cấu hình 1–8 slot.
- Mã request giữ nguyên khi retry mất ACK. Redis claim/attempt/lease chặn nhiều instance gọi cùng job. Phản hồi được lưu vào job trước khi chốt để có thể hoàn tất lại từ kết quả đã lưu, không inference lại.
- Groq 429 áp dụng cooldown theo API key, tôn trọng Retry-After và hoàn reservation trước khi xếp lại; dừng sau ba lần từ chối. 4xx từ chối rõ ràng không trừ token. Timeout/5xx/mất body hoặc mất tiến trình sau prepare thành `uncertain`, giữ ngân sách và slot chờ admin đối soát; không tự gọi lại. Private/reset/thu hồi quyền chặn kết quả muộn.

## Runtime và vận hành

Runner là tác vụ Node trong web hiện có, khởi tạo qua instrumentation, tự bật trên Render (`RENDER=true`). Local/self-hosted đặt `GROQ_RUNNER_ENABLED=true`. Không cấp Pod, không thêm worker cloud tính phí và không đổi image GPU. Render Free có thể ngủ/cold-start; job chưa chạy giữ trong hàng đợi và được xét lại khi process hoạt động. Job đã prepare mà mất process không được tự chạy lại.

`/api/health` có `groqRunner.startedAt`, `lastPollAt`, `lastSuccessfulPollAt` để kiểm tra scheduler thực sự đã khởi tạo và đọc được database. Probe health không gọi database/provider. Đây là trạng thái scheduler, không phải bằng chứng inference thật.

Groq được gọi trực tiếp từ backend bằng Chat Completions; endpoint cố định, không nhận base URL từ browser. Model được đọc động từ Models API và lọc theo các họ chat văn bản đã hỗ trợ trong `groq.ts`; chưa cung cấp audio, moderation, Compound, tool calling hoặc model có contract chưa hỗ trợ. Không tự chuyển provider/model khi lỗi.

Tham khảo: [Groq API](https://console.groq.com/docs/api-reference), [Models](https://console.groq.com/docs/models), [Rate limits](https://console.groq.com/docs/rate-limits). Giới hạn Groq thuộc tổ chức, có thể chung giữa nhiều API key; cấu hình trên Arena không làm tăng quota Groq và không phải hard cap hóa đơn. Xem hạn mức thực trong Groq Console.

## Kiểm tra

```
npm run typecheck
npx tsx --test --test-concurrency=1 tests/*.test.ts
npm run build
npx tsx --env-file=.env --env-file=.local/supabase-runtime.env scripts/qa-groq-flow.ts
npx tsx --env-file=.env --env-file=.local/supabase-runtime.env scripts/qa-sql-database.ts
```

Hai script tích hợp dùng Supabase/Redis thật trong namespace QA ngẫu nhiên và tự dọn; mọi gọi Groq/Runpod đều giả lập. Browser: dùng Playwright CLI mở web đã đăng nhập rồi `run-code --filename scripts/qa-groq-ui.js`; script đọc Workspace thật, giả lập key/model/cấp phát và hội thoại, chụp desktop/mobile vào `output/playwright/`. Dùng `scripts/qa-chat-sessions.js` cho kiểm tra phiên chat chung. Đăng xuất, đóng phiên và xóa auth state sau QA. Chưa có khóa Groq thật thì không coi các kiểm tra này là nghiệm thu inference/tốc độ/chi phí thật.

Migration additive `chatbot_api_credentials` không sửa ledger/khóa Runpod. Bảng mới có RLS theo namespace, chỉ role backend truy cập. Export/import/restore database đã bao gồm credential API dưới dạng mã hóa. Không đổi database mode hoặc khóa mã hóa khi phát hành/rollback code.
