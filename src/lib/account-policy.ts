export const ACCOUNT_CHANGE_INTERVAL = 30 * 86400_000;
export const EMAIL_REQUEST_TTL = 3600_000;
export const nextAccountChange = (last: number | null | undefined) =>
  last == null ? null : Number(last) + ACCOUNT_CHANGE_INTERVAL;
export const accountChangeAllowed = (
  last: number | null | undefined,
  now: number,
) => last == null || now >= Number(last) + ACCOUNT_CHANGE_INTERVAL;
export type LoginProvider = "google" | "email" | "legacy";
