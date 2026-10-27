import type { Contest } from "./types";

export function roundVisible(c: Contest | null | undefined, admin = false) {
  return !!c && !c.deletedAt && (admin || !c.hidden);
}
