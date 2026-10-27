import { z } from "zod";

export const registrationName = z
  .string()
  .trim()
  .max(254)
  .email("Nhập email hợp lệ.")
  .transform((s) => s.toLowerCase());
// Existing accounts, including the administrator, can continue using their username.
export const loginName = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .transform((s) => s.toLowerCase());
