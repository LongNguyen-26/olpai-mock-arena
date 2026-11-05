/** Production tools use the public domain; another host must be selected explicitly. */
export function arenaBaseUrl() {
  const value = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7)
    ?? (process.env.ARENA_BASE_URL || "https://olpaiarena.cyou");
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  ) throw new Error("Arena base URL must be an HTTPS origin (HTTP only for localhost).");
  return url.origin;
}
