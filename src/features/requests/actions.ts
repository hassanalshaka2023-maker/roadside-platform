"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import {
  formBool,
  formString,
  runAction,
  toErrorResult,
  type ActionResult,
} from "@/lib/action-result";
import { assertSameOrigin } from "@/lib/auth/csrf";
import { deterministicUuid } from "@/lib/crypto";
import { requestOtp, verifyOtp } from "@/lib/auth/otp";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { loggerFor } from "@/lib/logger";
import { normalizeSyrianPhone } from "@/lib/phone";
import { consumeLimit } from "@/lib/rate-limit";
import { getRequestContext } from "@/lib/request-context";
import { readSetting } from "@/features/settings/platform";
import { COMPLAINT_CATEGORIES, fileComplaint, rateProvider } from "@/features/feedback/service";
import {
  confirmCompletion,
  disputeCompletion,
  respondToExtraCharge,
} from "@/features/jobs/service";
import { acceptOfferSchema } from "@/features/offers/schemas";
import { acceptOffer } from "@/features/offers/service";
import { DomainError } from "./errors";
import { createRequestInputSchema, destinationSchema } from "./schemas";
import {
  cancelByCustomer,
  createRequest,
  createTowingFallback,
  isIdRequiredFor,
  restartSearch,
} from "./service";

const log = loggerFor("requests/actions");

export interface RequestFlowState extends ActionResult<{ trackingToken: string }> {
  phone?: string;
  resendAfterSeconds?: number;
  /** After phone verification: must this customer attach an ID? */
  idRequired?: boolean;
}

// ---------------------------------------------------------------------------
// Submitting a request (with OTP for guests)
// ---------------------------------------------------------------------------

/**
 * Sends the code for the request flow. The REQUEST purpose means a code
 * issued here cannot be replayed against the plain login form.
 */
export async function requestFlowOtpAction(
  _prev: RequestFlowState,
  formData: FormData,
): Promise<RequestFlowState> {
  try {
    await assertSameOrigin("POST");
  } catch (error) {
    return toErrorResult(error);
  }

  const normalized = normalizeSyrianPhone(formString(formData, "phone"));
  if (!normalized.ok) return { ok: false, errorKey: `phoneErrors.${normalized.code}` };

  const locale = formString(formData, "locale") || "ar";
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
      errorValues: { seconds: result.retryAfterSeconds ?? 0 },
    };
  }

  return { ok: true, phone: normalized.phone, resendAfterSeconds: result.resendAfterSeconds };
}

/**
 * Step 4 for a guest: verify the code, find or create the account, open a
 * session. After this the browser can upload photos (uploads need a
 * session) and submit. Admin accounts cannot place requests.
 */
export async function verifyRequestPhoneAction(
  _prev: RequestFlowState,
  formData: FormData,
): Promise<RequestFlowState> {
  try {
    await assertSameOrigin("POST");
  } catch (error) {
    return toErrorResult(error);
  }

  const context = await getRequestContext();
  const normalized = normalizeSyrianPhone(formString(formData, "phone"));
  if (!normalized.ok) return { ok: false, errorKey: `phoneErrors.${normalized.code}` };

  const verification = await verifyOtp(normalized.phone, formString(formData, "code").trim(), "REQUEST", {
    ip: context.ip,
  });
  if (!verification.ok) {
    return {
      ok: false,
      phone: normalized.phone,
      errorKey: `otpErrors.${verification.reason}`,
      errorValues:
        verification.attemptsLeft !== undefined ? { count: verification.attemptsLeft } : undefined,
    };
  }

  const user = await prisma.user.upsert({
    where: { phone: normalized.phone },
    create: { phone: normalized.phone, role: "CUSTOMER", isPhoneVerified: true, lastLoginAt: new Date() },
    update: { isPhoneVerified: true, lastLoginAt: new Date() },
    select: { id: true, role: true, status: true },
  });

  if (user.status !== "ACTIVE" || user.role === "ADMIN") {
    log.warn({ userId: user.id }, "request blocked: account not usable");
    // Same message as a wrong code: nothing about the account leaks.
    return { ok: false, phone: normalized.phone, errorKey: "otpErrors.INVALID_CODE" };
  }

  await createSession(user.id, false, { ip: context.ip, userAgent: context.userAgent });
  const idRequired = await isIdRequiredFor(user.id, await readSetting("customerIdMode"));
  return { ok: true, phone: normalized.phone, idRequired };
}

/**
 * Turns the filled-in form into a real request, for a signed-in customer.
 *
 * Returns the tracking token instead of redirecting, so the browser keeps its
 * draft until it knows the request exists. IDEMPOTENT: a retry with the same
 * clientRequestId returns the same request.
 */
export async function submitRequestAction(
  _prev: RequestFlowState,
  formData: FormData,
): Promise<RequestFlowState> {
  return runAction(
    "createRequest",
    async ({ user, ip }) => {
      let payload: unknown;
      try {
        payload = JSON.parse(formString(formData, "payload") || "{}");
      } catch {
        payload = {};
      }
      const input = createRequestInputSchema.parse(payload);

      const limit = await consumeLimit("requestCreatePerUser", user.id);
      if (!limit.allowed) throw new DomainError("RATE_LIMITED");

      const idMode = await readSetting("customerIdMode");
      const idRequired = await isIdRequiredFor(user.id, idMode);
      const created = await createRequest({ customerId: user.id, input, idRequired, ip });
      return { trackingToken: created.trackingToken };
    },
  );
}

// ---------------------------------------------------------------------------
// Tracking page actions (customer)
// ---------------------------------------------------------------------------

const requestIdSchema = z.uuid();

function requestIdFrom(formData: FormData): string {
  return requestIdSchema.parse(formString(formData, "requestId"));
}

export async function cancelRequestAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "cancelOwnRequest",
    async ({ user, ip }) => {
      await cancelByCustomer({
        requestId: requestIdFrom(formData),
        customerId: user.id,
        reason: formString(formData, "reason").slice(0, 300) || undefined,
        ip,
      });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function restartSearchAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "createRequest",
    async ({ user, ip }) => {
      await restartSearch({ requestId: requestIdFrom(formData), actor: "CUSTOMER", actorUserId: user.id, ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function towingFallbackAction(
  _prev: ActionResult<{ trackingToken: string }>,
  formData: FormData,
): Promise<ActionResult<{ trackingToken: string }>> {
  return runAction(
    "createRequest",
    async ({ user, ip }) => {
      const destination = destinationSchema.parse({
        destinationText: formString(formData, "destinationText"),
        vehicleCanRoll: formString(formData, "vehicleCanRoll") === ""
          ? undefined
          : formString(formData, "vehicleCanRoll") === "yes",
      });
      const requestId = requestIdFrom(formData);
      const created = await createTowingFallback({
        requestId,
        customerId: user.id,
        // Derived, not random: pressing the button twice (or a retry after a
        // dropped connection) maps to the same towing request.
        clientRequestId: deterministicUuid(`towing-fallback:${requestId}`),
        ...destination,
        ip,
      });
      const locale = formString(formData, "locale") === "en" ? "en" : "ar";
      redirect(`/${locale}/track/${created.trackingToken}`);
    },
    { rateLimit: "requestCreatePerUser" },
  );
}

export async function acceptOfferAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "viewOwnRequests",
    async ({ user, ip }) => {
      const input = acceptOfferSchema.parse({
        requestId: formString(formData, "requestId"),
        offerId: formString(formData, "offerId"),
        feeTermsAccepted: formBool(formData, "feeTermsAccepted"),
      });
      await acceptOffer({ requestId: input.requestId, offerId: input.offerId, actor: "CUSTOMER", actorUserId: user.id, ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function respondExtraAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "viewOwnRequests",
    async ({ user, ip }) => {
      await respondToExtraCharge({
        customerId: user.id,
        extraId: z.uuid().parse(formString(formData, "extraId")),
        approve: formString(formData, "decision") === "approve",
        ip,
      });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function confirmCompletionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "viewOwnRequests",
    async ({ user, ip }) => {
      if (!formBool(formData, "paidConfirmed")) {
        throw new z.ZodError([{ code: "custom", path: ["paidConfirmed"], message: "PAYMENT_CONFIRMATION_REQUIRED", input: undefined }]);
      }
      await confirmCompletion({ customerId: user.id, requestId: requestIdFrom(formData), ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function disputeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "viewOwnRequests",
    async ({ user, ip }) => {
      const reason = z.string().trim().min(5, "REASON_REQUIRED").max(1000).parse(formString(formData, "reason"));
      await disputeCompletion({ customerId: user.id, requestId: requestIdFrom(formData), reason, ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function rateAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "rateProvider",
    async ({ user, ip }) => {
      const stars = z.coerce.number().int().min(1, "STARS_REQUIRED").max(5).parse(formString(formData, "stars"));
      const comment = z.string().trim().max(500).parse(formString(formData, "comment"));
      await rateProvider({ customerId: user.id, requestId: requestIdFrom(formData), stars, comment, ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function complaintAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "fileComplaint",
    async ({ user, ip }) => {
      const category = z.enum(COMPLAINT_CATEGORIES).parse(formString(formData, "category"));
      const description = z.string().trim().min(5, "REASON_REQUIRED").max(2000).parse(formString(formData, "description"));
      await fileComplaint({ userId: user.id, requestId: requestIdFrom(formData), category, description, ip });
      return undefined;
    },
    { rateLimit: "complaintPerUser" },
  );
}
