import type { WorkspaceTemplate } from "./workspace-domain";

export function gpuCloudPrice(
  price: { secure: number | null; community: number | null } | undefined,
  cloud: WorkspaceTemplate["cloudType"],
): number | null {
  const values =
    cloud === "ALL"
      ? [price?.community, price?.secure]
      : [price?.[cloud === "SECURE" ? "secure" : "community"]];
  const known = values.filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0,
  );
  // ALL may land on either cloud. Budget against the higher catalogue price.
  return known.length ? Math.max(...known) : null;
}
