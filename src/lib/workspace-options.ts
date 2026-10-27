export type WorkspaceScope = "team" | "all";
export type WorkspaceServices = "both" | "llm" | "jupyter";
export const serviceOptions = [
  {
    id: "both",
    label: "Chatbot + JupyterLab",
    description: "Hai dịch vụ cùng dùng GPU",
  },
  {
    id: "llm",
    label: "Chỉ Chatbot",
    description: "Chạy DeepSeek, không mở Jupyter",
  },
  {
    id: "jupyter",
    label: "Chỉ JupyterLab",
    description: "Dành GPU cho notebook, không nạp LLM",
  },
] as const;
export const hasService = (
  w: { services?: WorkspaceServices },
  service: "llm" | "jupyter",
) => !w.services || w.services === "both" || w.services === service;
export const isShared = (w: { scope?: WorkspaceScope }) => w.scope === "all";
export const servicesOverlap = (a: WorkspaceServices, b: WorkspaceServices) =>
  a === "both" || b === "both" || a === b;
