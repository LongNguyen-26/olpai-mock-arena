import { hubLoginOrigins } from "./hub-domain";

/** Explicit public origin takes precedence; Render supplies a safe default. */
export function workspaceDeployment(env: Record<string, string | undefined> = process.env) {
  const value = env.GPU_WORKSPACE_PUBLIC_URL ||
    (env.RENDER === "true" ? env.RENDER_EXTERNAL_URL : undefined);
  if (!value) throw new Error("Thiếu GPU_WORKSPACE_PUBLIC_URL là HTTPS origin công khai.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash) {
    throw new Error("GPU_WORKSPACE_PUBLIC_URL phải là HTTPS origin công khai.");
  }
  const loginOrigins = hubLoginOrigins(url.origin, env.GPU_WORKSPACE_LOGIN_ORIGINS);
  return { controlOrigin: url.origin, loginOrigins };
}
