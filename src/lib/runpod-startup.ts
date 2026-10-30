export type PodStartupFailure = "gpu-reset" | "container";
export type PodStartupProgress = "pulling" | "extracting";
export interface PodStartupDiagnostic {
  failure: PodStartupFailure | null;
  progress: PodStartupProgress | null;
}

export function podStartupProgress(line: string): PodStartupProgress | null {
  if (/\b[a-f0-9]{12}\s+Extracting\b/i.test(line)) return "extracting";
  if (
    /still fetching image|Pulling (?:image|fs layer|from)|\b[a-f0-9]{12}\s+(?:Downloading|Waiting|Verifying Checksum|Download complete)\b/i.test(
      line,
    )
  )
    return "pulling";
  return null;
}

export function podStartupProgressMessage(progress: PodStartupProgress) {
  return progress === "extracting"
    ? "Runpod đang giải nén image Docker trên host; container và dịch vụ trên Pod chưa sẵn sàng. Kiểm tra System Logs nếu không còn tiến độ giải nén."
    : "Runpod đang tải image Docker trên host; container và dịch vụ trên Pod chưa khởi động. Số layer trên Connect không xác nhận ứng dụng đã chạy. Nếu System Logs chỉ lặp 'still fetching image' kéo dài, cần kiểm tra việc pull image ở host Runpod.";
}

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
