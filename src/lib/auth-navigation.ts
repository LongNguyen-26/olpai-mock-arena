// Only return to a section of this application, including its selected round.
export function authReturnPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://arena.invalid");
    if (url.origin !== "https://arena.invalid" || url.pathname !== "/") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}
export const publicSections = new Set(["rounds", "overview", "statement", "leaderboard"]);
export function loginHref(next: string, register = false) {
  return `/login?${register ? "mode=register&" : ""}next=${encodeURIComponent(authReturnPath(next))}`;
}
