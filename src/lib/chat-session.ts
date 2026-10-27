type SessionStorage = Pick<Storage, "getItem" | "setItem">;

/** Browser-only: sessionStorage belongs to this tab and survives a reload. */
export function chatSession(
  storage: SessionStorage,
  workspaceId: string,
  fresh = false,
): string {
  const key = `arena-chat:${workspaceId}`;
  const current = storage.getItem(key);
  // The old default used the Pod ID, so never resume that shared conversation.
  if (!fresh && current && current !== workspaceId) return current;
  const next = crypto.randomUUID();
  storage.setItem(key, next);
  return next;
}
