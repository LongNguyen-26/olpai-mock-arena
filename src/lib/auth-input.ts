import { z } from "zod";
export const profileName = z.string().trim().transform(value => value.replace(/\s+/gu, " ")).pipe(
  z.string().min(2, "Tên cần có ít nhất 2 ký tự.").max(60, "Tên tối đa 60 ký tự.")
    .refine(value => !value.includes("@") && !/[\p{Cc}\p{Cf}]/u.test(value), "Hãy nhập tên hiển thị, không dùng địa chỉ email."),
);

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
