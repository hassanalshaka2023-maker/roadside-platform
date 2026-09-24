"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { assertSameOrigin, CsrfError } from "@/lib/auth/csrf";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requestOtp, verifyOtp } from "@/lib/auth/otp";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { loggerFor } from "@/lib/logger";
import { maskPhone, normalizeSyrianPhone } from "@/lib/phone";
import { consumeLimit } from "@/lib/rate-limit";
import { getRequestContext } from "@/lib/request-context";
import { getSetting } from "@/features/settings/queries";
import { IllegalTransitionError } from "./state-machine";
import {
  cancelByCustomer,
  createRequest,
  IdDocumentRequiredError,
  isIdRequiredFor,
  RequestNotFoundError,
  type CustomerIdMode,
} from "./service";
import { cancelRequestSchema, createRequestSchema } from "./schemas";

const log = loggerFor("requests/actions");

export interface RequestActionState {
  ok: boolean;
  /** Namespace-qualified translation key. */
  errorKey?: string;
  errorValues?: Record<string, string | number>;
  /** Set on the OTP step. */
  phone?: string;
  resendAfterSeconds?: number;
  /** Set once the request exists, so the client can redirect to tracking. */
  trackingToken?: string;
  publicCode?: string;
}

const EMPTY_STATE: RequestActionState = { ok: false };

async function guard(): Promise<RequestActionState | null> {
  try {
    await assertSameOrigin("POST");
    return null;
  } catch (error) {
    if (error instanceof CsrfError) return { ok: false, errorKey: "errors.csrf" };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Step 4: verify the phone, which also creates the account
// ---------------------------------------------------------------------------

/**
 * Sends the code for the request flow.
 *
 * Uses the REQUEST purpose rather than LOGIN so a code issued for placing a
 * request cannot be replayed against the plain login form, and vice versa.
 */
export async function requestFlowOtpAction(
  _prev: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const blocked = await guard();
  if (blocked) return blocked;

  const normalized = normalizeSyrianPhone(String(formData.get("phone") ?? ""));
  if (!normalized.ok) {
    return { ok: false, errorKey: `phoneErrors.${normalized.code}` };
  }

  const locale = String(formData.get("locale") ?? "ar");
  const context = await getRequestContext();
  const t = await getTranslations({ locale, namespace: "otpSms" });

  const result = await requestOtp(
    normalized.phone,
    "REQUEST",
    (code) => t("loginBody", { code, minutes: Math.round(env.OTP_TTL_SECONDS / 60) }),
    { ip: context.ip },
  );

  if (!result.ok) {
    return {
      ok: false,
      phone: normalized.phone,
      errorKey: `otpErrors.${result.reason}`,
      errorValues: { seconds: result.retryAfterSeconds },
    };
  }

  return {
    ok: true,
    phone: normalized.phone,
    resendAfterSeconds: result.resendAfterSeconds,
  };
}

// ---------------------------------------------------------------------------
// Step 5: verify the code and submit the whole request
// ---------------------------------------------------------------------------

/**
 * The one action that turns a guest's filled-in form into a real request.
 *
 * Verifies the code, finds or creates the account, opens a session, then
 * creates the request. Deliberately a single action: a half-finished state
 * where the account exists but the request does not would leave the customer
 * logged in on a blank page, wondering whether help is coming.
 */
export async function submitRequestAction(
  _prev: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const blocked = await guard();
  if (blocked) return blocked;

  const locale = String(formData.get("locale") ?? "ar");
  const context = await getRequestContext();

  // --- phone + code ------------------------------------------------------
  const normalized = normalizeSyrianPhone(String(formData.get("phone") ?? ""));
  if (!normalized.ok) {
    return { ok: false, errorKey: `phoneErrors.${normalized.code}` };
  }

  const code = String(formData.get("code") ?? "").trim();
  const verification = await verifyOtp(normalized.phone, code, "REQUEST", {
    ip: context.ip,
  });

  if (!verification.ok) {
    return {
      ok: false,
      phone: normalized.phone,
      errorKey: `otpErrors.${verification.reason}`,
      errorValues:
        verification.attemptsLeft !== undefined
          ? { count: verification.attemptsLeft }
          : undefined,
    };
  }

  // --- the request payload ------------------------------------------------
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { ok: false, errorKey: "requests.errors.INVALID_PAYLOAD" };
  }

  const parsed = createRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    log.warn({ path: issue?.path.join("."), code: issue?.message }, "request payload rejected");
    return { ok: false, errorKey: `requests.errors.${issue?.message ?? "INVALID_PAYLOAD"}` };
  }

  // --- account ------------------------------------------------------------
  const user = await prisma.user.upsert({
    where: { phone: normalized.phone },
    create: {
      phone: normalized.phone,
      role: "CUSTOMER",
      isPhoneVerified: true,
      lastLoginAt: new Date(),
    },
    update: { isPhoneVerified: true, lastLoginAt: new Date() },
    select: { id: true, role: true, status: true },
  });

  if (user.status !== "ACTIVE") {
    log.warn({ userId: user.id, status: user.status }, "request blocked: account not active");
    // Same generic message as a bad code - a blocked user should not learn
    // that their number is the reason.
    return { ok: false, phone: normalized.phone, errorKey: "otpErrors.INVALID_CODE" };
  }

  // Rate limited per user, after we know who they are.
  const limit = await consumeLimit("requestCreatePerUser", user.id);
  if (!limit.allowed) {
    return { ok: false, errorKey: "requests.errors.RATE_LIMITED" };
  }

  await createSession(user.id, user.role === "ADMIN", {
    ip: context.ip,
    userAgent: context.userAgent,
  });

  // --- create -------------------------------------------------------------
  const idMode = await getSetting<CustomerIdMode>("customerIdMode", "NEVER");
  const idRequired = await isIdRequiredFor(user.id, idMode);

  try {
    const created = await createRequest({
      customerId: user.id,
      input: parsed.data,
      idRequired,
      ip: context.ip,
    });

    log.info(
      { requestId: created.id, phoneMasked: maskPhone(normalized.phone) },
      "request submitted",
    );

    redirect(`/${locale}/track/${created.trackingToken}`);
  } catch (error) {
    // `redirect` throws by design; let it through.
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;

    if (error instanceof IdDocumentRequiredError) {
      return { ok: false, errorKey: "requests.errors.ID_REQUIRED" };
    }

    log.error({ err: error, userId: user.id }, "request creation failed");
    return { ok: false, errorKey: "errors.genericTitle" };
  }
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export async function cancelRequestAction(
  _prev: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const blocked = await guard();
  if (blocked) return blocked;

  const user = await getCurrentUser();
  if (!user) return { ok: false, errorKey: "errors.unauthorized" };

  const parsed = cancelRequestSchema.safeParse({
    requestId: formData.get("requestId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) return { ok: false, errorKey: "requests.errors.INVALID_PAYLOAD" };

  const context = await getRequestContext();

  try {
    await cancelByCustomer({
      requestId: parsed.data.requestId,
      customerId: user.id,
      reason: parsed.data.reason || undefined,
      ip: context.ip,
    });

    return { ok: true };
  } catch (error) {
    if (error instanceof RequestNotFoundError) {
      return { ok: false, errorKey: "requests.errors.NOT_FOUND" };
    }

    if (error instanceof IllegalTransitionError) {
      return { ok: false, errorKey: "requests.errors.CANNOT_CANCEL" };
    }

    log.error({ err: error, userId: user.id }, "cancellation failed");
    return { ok: false, errorKey: "errors.genericTitle" };
  }
}

export { EMPTY_STATE as emptyRequestActionState };
