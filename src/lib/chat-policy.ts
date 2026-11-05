import type { WorkspaceTemplate } from "./workspace-domain";

export type ChatPolicy = Pick<WorkspaceTemplate,
  "tokenLimitMode" | "sessionTokenLimit" | "inputTokenLimit" | "outputTokenLimit">;
export type ApiChatTemplate = ChatPolicy & { id: string; name: string; imageName?: undefined };
export type ChatTemplate = WorkspaceTemplate | ApiChatTemplate;
