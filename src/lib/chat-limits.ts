import type { ChatSession, WorkspaceTemplate } from "./workspace-domain";

export function chatLimitSummary(t: WorkspaceTemplate, s: ChatSession) {
  const total = `Tổng phiên: ${s.inputTokens + s.outputTokens}/${t.sessionTokenLimit} token · Còn ${Math.max(0, t.sessionTokenLimit - s.inputTokens - s.outputTokens)}`;
  if (t.tokenLimitMode === "turn")
    return `${total} · Mỗi lượt: Input ≤ ${t.inputTokenLimit} · Output ≤ ${t.outputTokenLimit}`;
  if (t.tokenLimitMode === "session")
    return `${total} · Input phiên: ${s.inputTokens}/${t.inputTokenLimit} · Output phiên: ${s.outputTokens}/${t.outputTokenLimit}`;
  return `${s.inputTokens + s.outputTokens}/${t.sessionTokenLimit} token · Input ≤ ${t.inputTokenLimit}/lượt · Output ≤ ${t.outputTokenLimit}/lượt`;
}
export function chatUsageLog(t: WorkspaceTemplate, s: ChatSession) {
  const last = s.lastTurn
    ? ` Lượt vừa rồi: input ${s.lastTurn.inputTokens}, output ${s.lastTurn.outputTokens}${s.lastTurn.rejected ? " (không gọi model)" : ""}.`
    : "";
  const policy =
    t.tokenLimitMode === "turn"
      ? "Input/output giới hạn từng lượt; tổng input + output vẫn cộng dồn trong phiên. Input tính cả lịch sử gửi tới model."
      : t.tokenLimitMode === "session"
        ? "Input và output được cộng dồn riêng trong phiên. Lịch sử gửi lại vẫn tính vào input."
        : `Phiên này: ${s.inputTokens + s.outputTokens}/${t.sessionTokenLimit} token. Input đã dùng ${s.inputTokens}; output đã dùng ${s.outputTokens}.`;
  return `${chatLimitSummary(t, s)}. ${policy}${last}`;
}
export function isChatClosed(t: WorkspaceTemplate, s: ChatSession) {
  if (s.pending) return true;
  return (
    !!s.exhausted ||
    s.inputTokens + s.outputTokens >= t.sessionTokenLimit ||
    (t.tokenLimitMode === "session"
      ? s.inputTokens >= t.inputTokenLimit ||
        s.outputTokens >= t.outputTokenLimit
      : s.inputTokens + s.outputTokens >= t.sessionTokenLimit)
  );
}
