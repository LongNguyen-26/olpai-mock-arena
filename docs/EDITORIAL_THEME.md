# Nhận diện tối giản — 07/11/2026

Áp dụng mockup đã được người dùng duyệt: nền trắng ngà, sidebar than ấm, điểm nhấn đất nung tiết chế. Giữ nội dung vòng luyện và ảnh bìa gốc; giảm saturation ảnh bằng CSS, không sửa asset.

- `src/app/editorial-theme.css`: token màu và style dùng chung, import cuối trong root layout. Success/warning/error vẫn phân biệt; điều hướng active và focus bàn phím có dấu hiệu rõ ràng.
- `src/components/brand-identity.tsx`: SVG monogram A và wordmark dùng chung cho shell, loading, đăng nhập, onboarding, xác nhận email và trang pháp lý. Link logo có accessible name ngay cả khi wordmark bị ẩn ở tablet.
- `src/app/icon.svg`: favicon mới; `scripts/export-oauth-logo.mjs` xuất PNG 120/512 từ cùng thiết kế. Google Auth Platform là cấu hình bên ngoài; xem `OAUTH_BRANDING.md`.
- Source Serif 4 Variable 5.3.1 dùng cho tiêu đề biên tập và wordmark, có Vietnamese subset. Đóng gói bằng Fontsource và phục vụ cùng host. Be Vietnam Pro giữ cho UI/bảng/form; IBM Plex Mono giữ cho code.
- Trang chủ vẫn lưới hai cột trên desktop, một cột ở tablet/mobile. Menu mobile và nút đăng nhập tối thiểu 44px; input tìm/lọc dùng 16px trên mobile.
- Không thay API, quyền truy cập, scoring, dữ liệu, cấu hình cloud hay runtime GPU.

## Kiểm tra trước phát hành

- TypeScript qua; 114/114 unit test qua (`node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/*.test.ts`).
- `npm run build` qua với production Turbopack; Windows sandbox cần quyền tạo junction để build.
- Playwright kiểm tra bản production trên localhost: logo, màu sidebar, font tiếng Việt, tìm/lọc vòng, không tràn ngang ở 1440/768/390px; trang tổng quan/đề/bảng điểm, đăng nhập, privacy, terms, xác nhận email. Không có browser exception hoặc HTTP lỗi trong các kiểm tra này.
- Local catalogue dùng anonymous public GET được replay, chặn mọi mutation; Workspace/chat dùng fixture giả lập. Đã kiểm tra desktop/mobile và monospace trong code block. Không tạo Pod, gọi model hoặc gửi email.
- Ảnh QA và callback kiểm tra lưu tại `output/playwright/editorial-*` và `output/playwright/check-editorial*.js` (ignored).

Sau phát hành cần đối chiếu full SHA trên Render, chạy smoke đọc/đăng nhập/đăng xuất và chụp lại trang chủ từ tên miền thật.
