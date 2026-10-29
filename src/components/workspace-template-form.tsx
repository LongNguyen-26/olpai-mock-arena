"use client";
import { Cpu, HardDrive, MessageSquare, Save, Copy } from "lucide-react";
import type { GpuPrice } from "@/lib/runpod";
import type { WorkspaceTemplate } from "@/lib/workspace-domain";
import type { WorkspaceServices } from "@/lib/workspace-options";
import { gpuCloudPrice } from "@/lib/gpu-pricing";

type Props = {
  template: WorkspaceTemplate;
  templates: WorkspaceTemplate[];
  services: WorkspaceServices;
  gpus: GpuPrice[];
  busy: boolean;
  saved: boolean;
  duplicateName: boolean;
  resourceBusy: boolean;
  resourceMessage: string;
  overwrite: boolean;
  onEdit: <K extends keyof WorkspaceTemplate>(
    field: K,
    value: WorkspaceTemplate[K],
  ) => void;
  onSelect: (template: WorkspaceTemplate | null) => void;
  onGpuChange: (gpu: string, cloud: WorkspaceTemplate["cloudType"]) => void;
  onSave: (confirmed?: boolean) => void;
  onCancelOverwrite: () => void;
  onClone: () => void;
};
export default function WorkspaceTemplateForm({
  template: t,
  templates,
  services,
  gpus,
  busy,
  saved,
  duplicateName,
  resourceBusy,
  resourceMessage,
  overwrite,
  onEdit,
  onSelect,
  onSave,
  onGpuChange,
  onCancelOverwrite,
  onClone,
}: Props) {
  const label =
    services === "jupyter"
      ? "JupyterLab"
      : services === "llm"
        ? "Chatbot"
        : "Chatbot + JupyterLab";
  function number(
    field:
      | "minRAMPerGPU"
      | "minVCPUPerGPU"
      | "containerDiskInGb"
      | "volumeInGb"
      | "sessionTokenLimit"
      | "inputTokenLimit"
      | "outputTokenLimit",
    title: string,
    min: number,
    max: number,
  ) {
    return (
      <label key={field}>
        {title}
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          required
          value={t[field]}
          onChange={(e) => onEdit(field, Number(e.target.value))}
        />
      </label>
    );
  }
  return (
    <section className="panel gpu-panel gpu-template-panel">
      <div className="section-title">
        <h2>Template môi trường</h2>
        <span className="pill neutral">{label}</span>
      </div>
      <p className="template-intro">
        Kho dùng chung cho mọi admin. Thiết lập tài nguyên và lưu template trước
        khi cấp Pod.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <fieldset className="template-editor-fields" disabled={busy}>
          <div className="gpu-form-grid template-identity">
            <label>
              Template đã lưu
              <select
                value={templates.some((s) => s.id === t.id) ? t.id : ""}
                onChange={(e) => {
                  const chosen = templates.find((s) => s.id === e.target.value);
                  onSelect(chosen ?? null);
                }}
              >
                <option value="">Cấu hình mới</option>
                {templates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tên template
              <input
                value={t.name}
                maxLength={80}
                required
                onChange={(e) => onEdit("name", e.target.value)}
              />
            </label>
          </div>
          {duplicateName && (
            <p className="alert error" role="alert">
              Tên template đã có. Đặt tên khác để lưu cấu hình mới.
            </p>
          )}
          <fieldset className="template-group">
            <legend>
              <Cpu size={18} />
              Tài nguyên tính toán
            </legend>
            <label>
              GPU
              <select
                value={t.gpuTypeId}
                disabled={busy}
                onChange={(e) => onGpuChange(e.target.value, t.cloudType)}
              >
                {!gpus.some((g) => g.id === t.gpuTypeId) && (
                  <option value={t.gpuTypeId}>{t.gpuTypeId}</option>
                )}
                {gpus.map((g) => {
                  const price = gpuCloudPrice(g.price, t.cloudType);
                  return (
                    <option key={g.id} value={g.id}>
                      {g.name} · {g.memory} GB
                      {price != null ? ` · $${price}/giờ` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="gpu-form-grid template-resource-grid">
              <label>
                Cloud
                <select
                  value={t.cloudType}
                  onChange={(e) =>
                    onGpuChange(
                      t.gpuTypeId,
                      e.target.value as WorkspaceTemplate["cloudType"],
                    )
                  }
                >
                  <option value="COMMUNITY">Community</option>
                  <option value="SECURE">Secure</option>
                  <option value="ALL">All</option>
                </select>
              </label>
              {number("minRAMPerGPU", "RAM tối thiểu · GB", 1, 1024)}
              {number("minVCPUPerGPU", "vCPU tối thiểu", 1, 128)}
            </div>
            {t.cloudType === "ALL" && (
              <p className="gpu-hint">
                All cho phép cấp Pod từ cả Community và Secure. Dự toán dùng
                mức giá cao hơn trong bảng giá của hai cloud.
              </p>
            )}
            {resourceBusy && (
              <p role="status">Đang lấy RAM/vCPU theo GPU và cloud…</p>
            )}
            {resourceMessage && (
              <p className="gpu-hint" role="status">
                {resourceMessage}
              </p>
            )}
          </fieldset>
          <fieldset className="template-group">
            <legend>
              <HardDrive size={18} />
              {services === "jupyter"
                ? "Môi trường JupyterLab & lưu trữ"
                : "Môi trường chạy & lưu trữ"}
            </legend>
            <div className="gpu-form-grid">
              {number("containerDiskInGb", "Ổ hệ thống · GB", 20, 500)}
              {number(
                "volumeInGb",
                services === "llm" ? "Lưu trữ model · GB" : "Workspace · GB",
                50,
                2000,
              )}
            </div>
            <details className="template-image" open>
              <summary>Docker image / digest</summary>
              <label>
                Image đã chuẩn bị
                <input
                  value={t.imageName}
                  required
                  placeholder="image@sha256:…"
                  onChange={(e) => onEdit("imageName", e.target.value)}
                />
              </label>
            </details>
          </fieldset>
          {services !== "jupyter" && (
            <fieldset className="template-group template-chat-group">
              <legend>
                <MessageSquare size={18} />
                Ngân sách Chatbot
              </legend>
              <label>
                Cách áp dụng giới hạn token
                <select
                  value={t.tokenLimitMode ?? "legacy"}
                  onChange={(e) =>
                    onEdit(
                      "tokenLimitMode",
                      e.target.value as "session" | "turn",
                    )
                  }
                >
                  {!t.tokenLimitMode && (
                    <option value="legacy" disabled>
                      Cấu hình cũ · tổng input + output
                    </option>
                  )}
                  <option value="session">
                    Mỗi phiên · input/output cộng dồn riêng
                  </option>
                  <option value="turn">
                    Mỗi lượt · input/output cho từng prompt
                  </option>
                </select>
              </label>
              <p>
                {t.tokenLimitMode === "turn"
                  ? "Mỗi prompt có hạn mức input và output riêng. Lịch sử được rút gọn khi cần để vừa cửa sổ model; lịch sử trên giao diện vẫn giữ đầy đủ."
                  : "Input và output có hai ngân sách riêng, được cộng dồn qua các lượt trong phiên."}
              </p>
              <label>
                Lượt xử lý đồng thời / GPU
                <select
                  value={t.llmParallel ?? 1}
                  onChange={(e) =>
                    onEdit(
                      "llmParallel",
                      Number(e.target.value) as 1 | 2 | 4 | 8,
                    )
                  }
                >
                  {[1, 2, 4, 8].map((slots) => (
                    <option key={slots} value={slots}>
                      {slots} lượt
                    </option>
                  ))}
                </select>
              </label>
              <p className="gpu-hint">
                Áp dụng khi cấp Pod mới bằng image hỗ trợ xử lý đồng thời. Mỗi
                lượt giữ nguyên cửa sổ context; tăng số lượt cần thêm VRAM và
                kiểm tra tốc độ. Pod đang chạy giữ cấu hình đã cấp.
              </p>
              {!t.tokenLimitMode && (
                <p className="gpu-hint">
                  Tổng input + output của phiên luôn bị giới hạn, kể cả khi chọn
                  giới hạn từng lượt.
                </p>
              )}
              <div className="gpu-form-grid template-resource-grid">
                {number(
                  "sessionTokenLimit",
                  "Tổng token tối đa / phiên",
                  256,
                  16384,
                )}
                {number(
                  "inputTokenLimit",
                  `Input tối đa / ${t.tokenLimitMode === "session" ? "phiên" : "lượt"}`,
                  64,
                  8192,
                )}
                {number(
                  "outputTokenLimit",
                  `Output tối đa / ${t.tokenLimitMode === "session" ? "phiên" : "lượt"}`,
                  64,
                  4096,
                )}
              </div>
              <p className="gpu-hint">
                Trần tổng luôn có hiệu lực cùng giới hạn input/output. Lịch sử
                gửi lại tính vào input; token suy luận tính vào output. Lưu giới
                hạn mới sẽ cập nhật chatbot của Pod đang dùng template này. Tăng
                quá cửa sổ context đã cấp cần Pod mới; không tự khởi động lại
                Pod đang chạy.
              </p>
            </fieldset>
          )}
          <div className="gpu-actions">
            <button
              className="btn primary"
              disabled={
                busy || resourceBusy || duplicateName || saved || overwrite
              }
            >
              <Save size={17} />
              Lưu template
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onClone}
            >
              <Copy size={17} />
              Tạo bản sao
            </button>
            {templates.some((s) => s.id === t.id) && !saved && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  onSelect(templates.find((s) => s.id === t.id) ?? null)
                }
              >
                Nạp lại template đã lưu
              </button>
            )}
          </div>
          {overwrite && (
            <div
              className="gpu-confirm"
              role="alertdialog"
              aria-label="Xác nhận ghi đè template"
            >
              <p>
                Ghi đè template “{t.name}” với cấu hình đang hiển thị? Giới hạn
                chatbot áp dụng cho Pod đang dùng template; phần cứng và image
                chỉ áp dụng khi cấp Pod mới.
              </p>
              <button
                type="button"
                className="btn primary"
                disabled={busy || duplicateName || resourceBusy}
                onClick={() => onSave(true)}
              >
                Xác nhận ghi đè
              </button>
              <button type="button" className="btn" onClick={onCancelOverwrite}>
                Hủy ghi đè
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </section>
  );
}
