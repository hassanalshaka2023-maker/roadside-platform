"use server";

import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { adminLogin } from "@/lib/auth/admin-login";
import { assertSameOrigin, CsrfError } from "@/lib/auth/csrf";
import { getCurrentUser } from "@/lib/auth/current-user";
import { completeSignIn, parseChannel, sendSignInCode, type CodeFlowState } from "@/lib/auth/code-sign-in";
import { destroyCurrentSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getRequestContext } from "@/lib/request-context";
import { safeNextPath } from "./next-path";
import { adminLoginSchema } from "./schemas";

/**
 * Every action returns the same shape. `errorKey` is a translation key, never
 * a ready-made sentence: the server has no business deciding the language.
 */
export interface ActionState extends CodeFlowState {
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
// Step 1: request a code (by phone or by email)
// ---------------------------------------------------------------------------

export async function requestOtpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const blocked = await guard();
  if (blocked) return blocked;

  const context = await getRequestContext();
  return sendSignInCode({
    channel: parseChannel(formData.get("channel")),
    raw: String(formData.get("destination") ?? ""),
    purpose: "LOGIN",
    locale: String(formData.get("locale") ?? "ar"),
    ip: context.ip,
  });
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

  const locale = String(formData.get("locale") ?? "ar");
  const context = await getRequestContext();

  const result = await completeSignIn({
    channel: parseChannel(formData.get("channel")),
    destination: String(formData.get("destination") ?? ""),
    code: String(formData.get("code") ?? ""),
    purpose: "LOGIN",
    ip: context.ip,
    userAgent: context.userAgent,
  });
  if (!result.ok) return result.state;

  redirect(`/${locale}${safeNextPath(formData.get("next")) ?? (result.role === "PROVIDER" ? "/provider" : "/account")}`);
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
