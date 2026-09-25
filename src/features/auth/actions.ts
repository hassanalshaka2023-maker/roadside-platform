"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { audit } from "@/lib/audit";
import { adminLogin } from "@/lib/auth/admin-login";
import { assertSameOrigin, CsrfError } from "@/lib/auth/csrf";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requestOtp, verifyOtp } from "@/lib/auth/otp";
import { createSession, destroyCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { loggerFor } from "@/lib/logger";
import { maskPhone } from "@/lib/phone";
import { getRequestContext } from "@/lib/request-context";
import { safeNextPath } from "./next-path";
import { adminLoginSchema, requestOtpSchema, verifyOtpSchema } from "./schemas";

const log = loggerFor("auth/actions");

/**
 * Every action returns the same shape. `errorKey` is a translation key, never
 * a ready-made sentence: the server has no business deciding the language.
 */
export interface ActionState {
  ok: boolean;
  /** Namespace-qualified message key, e.g. "otpErrors.EXPIRED". */
  errorKey?: string;
  /** Values interpolated into the message, e.g. { seconds: 42 }. */
  errorValues?: Record<string, string | number>;
  /** E.164 phone, carried between the two OTP steps. */
  phone?: string;
  /** How long until a resend is allowed. */
  resendAfterSeconds?: number;
}

/** Shared guard: same-origin, and nothing else runs if it fails. */
async function guard(): Promise<ActionState | null> {
  try {
    await assertSameOrigin("POST");
    return null;
  } catch (error) {
    if (error instanceof CsrfError) {
      return { ok: false, errorKey: "errors.csrf" };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Step 1: request a code
// ---------------------------------------------------------------------------

export async function requestOtpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const blocked = await guard();
  if (blocked) return blocked;

  const parsed = requestOtpSchema.safeParse({ phone: formData.get("phone") });
  if (!parsed.success) {
    // The transform puts our phone error code in the issue message.
    const code = parsed.error.issues[0]?.message ?? "EMPTY";
    return { ok: false, errorKey: `phoneErrors.${code}` };
  }

  const { phone } = parsed.data;
  const locale = String(formData.get("locale") ?? "ar");
  const context = await getRequestContext();

  const t = await getTranslations({ locale, namespace: "otpSms" });
  const minutes = Math.round(env.OTP_TTL_SECONDS / 60);

  const result = await requestOtp(
    phone,
    "LOGIN",
    (code) => t("loginBody", { code, minutes }),
    { ip: context.ip },
  );

  if (!result.ok) {
    return {
      ok: false,
      phone,
      errorKey: `otpErrors.${result.reason}`,
      errorValues: { seconds: result.retryAfterSeconds },
    };
  }

  await audit({
    action: "auth.otp.requested",
    entityType: "phone",
    metadata: { phoneMasked: maskPhone(phone) },
    ip: context.ip,
  });

  return { ok: true, phone, resendAfterSeconds: result.resendAfterSeconds };
}

// ---------------------------------------------------------------------------
// Step 2: verify the code and sign in
// ---------------------------------------------------------------------------

export async function verifyOtpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const blocked = await guard();
  if (blocked) return blocked;

  const parsed = verifyOtpSchema.safeParse({
    phone: formData.get("phone"),
    code: formData.get("code"),
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "INVALID_CODE";
    const key = message === "INVALID_CODE" ? "otpErrors.INVALID_CODE" : `phoneErrors.${message}`;
    return { ok: false, errorKey: key, phone: String(formData.get("phone") ?? "") };
  }

  const { phone, code } = parsed.data;
  const locale = String(formData.get("locale") ?? "ar");
  const context = await getRequestContext();

  const result = await verifyOtp(phone, code, "LOGIN", { ip: context.ip });

  if (!result.ok) {
    return {
      ok: false,
      phone,
      errorKey: `otpErrors.${result.reason}`,
      errorValues:
        result.attemptsLeft !== undefined ? { count: result.attemptsLeft } : undefined,
    };
  }

  // Find or create. A phone number is one identity: if this number already
  // belongs to an approved provider, they keep the PROVIDER role and simply
  // log in. See docs/adr/001-identity-model.md.
  const user = await prisma.user.upsert({
    where: { phone },
    create: { phone, role: "CUSTOMER", isPhoneVerified: true, lastLoginAt: new Date() },
    update: { isPhoneVerified: true, lastLoginAt: new Date() },
    select: { id: true, role: true, status: true },
  });

  if (user.status !== "ACTIVE") {
    log.warn({ userId: user.id, status: user.status }, "login blocked: account not active");
    // Same generic message as a bad code: a blocked user should not learn
    // that their number is the reason.
    return { ok: false, phone, errorKey: "otpErrors.INVALID_CODE" };
  }

  await createSession(user.id, user.role === "ADMIN", {
    ip: context.ip,
    userAgent: context.userAgent,
  });

  await audit({
    actorId: user.id,
    action: "auth.otp.verified",
    entityType: "user",
    entityId: user.id,
    ip: context.ip,
  });

  redirect(`/${locale}${safeNextPath(formData.get("next")) ?? (user.role === "PROVIDER" ? "/provider" : "/account")}`);
}

// ---------------------------------------------------------------------------
// Admin login
// ---------------------------------------------------------------------------

export async function adminLoginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const blocked = await guard();
  if (blocked) return blocked;

  const parsed = adminLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  // A malformed input is reported exactly like a wrong password.
  if (!parsed.success) {
    return { ok: false, errorKey: "adminLoginErrors.INVALID_CREDENTIALS" };
  }

  const locale = String(formData.get("locale") ?? "ar");
  const context = await getRequestContext();

  const result = await adminLogin(parsed.data.email, parsed.data.password, context);

  if (!result.ok) {
    return {
      ok: false,
      errorKey: `adminLoginErrors.${result.reason}`,
      errorValues: {
        minutes: Math.ceil((result.retryAfterSeconds ?? 0) / 60) || env.ADMIN_LOCKOUT_MINUTES,
      },
    };
  }

  redirect(`/${locale}/admin`);
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logoutAction(formData: FormData): Promise<void> {
  await assertSameOrigin("POST");

  const locale = String(formData.get("locale") ?? "ar");
  const user = await getCurrentUser();

  await destroyCurrentSession();

  if (user) {
    await audit({
      actorId: user.id,
      action: "auth.logout",
      entityType: "user",
      entityId: user.id,
    });
  }

  redirect(`/${locale}`);
}
