export type PodStartupFailure = "gpu-reset" | "container";

// Provider logs can contain credentials. Only return a classification, never text.
export function podStartupFailure(line: string): PodStartupFailure | null {
  if (!/error creating container/i.test(line)) return null;
  return /\[GPU requires reset\]/i.test(line) ? "gpu-reset" : "container";
}

export function podStartupMessage(failure: PodStartupFailure) {
  return failure === "gpu-reset"
    ? "GPU trên host Runpod cần reset; container chưa khởi động được. Liên hệ Runpod để reset host hoặc thu hồi Pod lỗi rồi thêm Pod thay thế vào nhóm. Dừng/chạy lại có thể vẫn dùng host cũ."
    : "Runpod báo lỗi tạo container. Kiểm tra System Logs trên Runpod trước khi cấp lại Pod.";
}
