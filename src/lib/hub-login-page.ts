import type { NotebookState } from "./hub-domain";

const escapeHtml = (text: string) => text
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Only transient states refresh, bounded below the browser nonce lifetime. */
export function hubPendingPage(url: URL, state: NotebookState) {
  const raw = url.searchParams.get("attempt") ?? "0";
  const attempt = /^\d{1,3}$/.test(raw) ? Number(raw) : 60;
  const refresh = attempt < 60 && ["preparing", "starting", "waiting-resource"].includes(state);
  const next = new URL(url);
  next.searchParams.set("attempt", String(attempt + 1));
  const message = !refresh
    ? "Chưa mở được JupyterLab. Hãy quay lại Arena để xem trạng thái và thử lại. Workspace đang chuẩn bị vẫn tiếp tục chạy."
    : state === "waiting-resource"
      ? "Workspace đang chờ RAM, dung lượng hoặc chỗ khởi động. Trang sẽ tự kiểm tra lại."
      : "Đang chuẩn bị workspace của đội. Trang sẽ tự kiểm tra lại trong tối đa 3 phút.";
  return `<!doctype html><html lang="vi"><meta charset="utf-8">${refresh ? `<meta http-equiv="refresh" content="3;url=${escapeHtml(next.pathname + next.search)}">` : ""}<meta name="viewport" content="width=device-width"><title>Đang mở JupyterLab</title><body><p role="status">${message}</p><a href="/">Về Arena</a></body></html>`;
}
