"use client";
import { Cpu, HardDrive, MessageSquare, Save, Copy } from "lucide-react";
import type { GpuPrice } from "@/lib/runpod";
import type { WorkspaceTemplate } from "@/lib/workspace-domain";
import type { WorkspaceServices } from "@/lib/workspace-options";

type Props = {
  template: WorkspaceTemplate;
  templates: WorkspaceTemplate[];
  services: WorkspaceServices;
  gpus: GpuPrice[];
  busy: boolean;
  onEdit: <K extends keyof WorkspaceTemplate>(
    field: K,
    value: WorkspaceTemplate[K],
  ) => void;
  onSelect: (template: WorkspaceTemplate) => void;
  onSave: () => void;
  onClone: () => void;
};
export default function WorkspaceTemplateForm({
  template: t,
  templates,
  services,
  gpus,
  busy,
  onEdit,
  onSelect,
  onSave,
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
        Thiết lập tài nguyên và lưu template trước khi cấp Pod.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <div className="gpu-form-grid template-identity">
          <label>
            Template đã lưu
            <select
              value={templates.some((s) => s.id === t.id) ? t.id : ""}
              onChange={(e) => {
                const chosen = templates.find((s) => s.id === e.target.value);
                if (chosen) onSelect(chosen);
              }}
            >
              <option value="" disabled>
                Cấu hình mới
              </option>
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
        <fieldset className="template-group">
          <legend>
            <Cpu size={18} />
            Tài nguyên tính toán
          </legend>
          <label>
            GPU
            <select
              value={t.gpuTypeId}
              onChange={(e) => onEdit("gpuTypeId", e.target.value)}
            >
              {!gpus.some((g) => g.id === t.gpuTypeId) && (
                <option value={t.gpuTypeId}>{t.gpuTypeId}</option>
              )}
              {gpus.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.memory} GB
                  {g.price[t.cloudType === "SECURE" ? "secure" : "community"] !=
                  null
                    ? ` · $${g.price[t.cloudType === "SECURE" ? "secure" : "community"]}/giờ`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="gpu-form-grid template-resource-grid">
            <label>
              Cloud
              <select
                value={t.cloudType}
                onChange={(e) =>
                  onEdit("cloudType", e.target.value as "SECURE" | "COMMUNITY")
                }
              >
                <option value="COMMUNITY">Community</option>
                <option value="SECURE">Secure</option>
              </select>
            </label>
            {number("minRAMPerGPU", "RAM tối thiểu · GB", 16, 1024)}
            {number("minVCPUPerGPU", "vCPU tối thiểu", 2, 128)}
          </div>
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
            <p>Giới hạn token theo phiên và mỗi lượt chat.</p>
            <div className="gpu-form-grid template-resource-grid">
              {number("sessionTokenLimit", "Tổng token / phiên", 256, 16384)}
              {number("inputTokenLimit", "Input tối đa / lượt", 64, 8192)}
              {number("outputTokenLimit", "Output tối đa / lượt", 64, 4096)}
            </div>
          </fieldset>
        )}
        <div className="gpu-actions">
          <button className="btn primary" disabled={busy}>
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
        </div>
      </form>
    </section>
  );
}
