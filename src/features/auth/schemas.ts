import { z } from "zod";

import { normalizeSyrianPhone } from "@/lib/phone";

/**
 * Input schemas for the auth flows.
 *
 * Phone normalization happens inside the schema via `transform`, so every
 * downstream consumer receives E.164 and nothing has to remember to convert.
 * The error message is an error CODE, resolved to Arabic by the caller
 * through messages/*.json.
 */
export const phoneSchema = z
  .string()
  .min(1, "EMPTY")
  .transform((value, ctx) => {
    const result = normalizeSyrianPhone(value);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.code });
      return z.NEVER;
    }
    return result.phone;
  });

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,10}$/, "INVALID_CODE"),
});

export const adminLoginSchema = z.object({
  // Not z.email(): a malformed email must fail as "invalid credentials", the
  // same as a wrong password, so the form never distinguishes the two.
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(200),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
