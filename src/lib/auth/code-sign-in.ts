/**
 * Sign-in with a one-time code, by phone OR by email.
 *
 * One place for both channels, used by the login page and the request form:
 * parse the destination, send the code, verify it, find or create the
 * account, open the session.
 *
 * Accounts are keyed by the channel used: a phone sign-in finds the user by
 * `phone`, an email sign-in by `email`. The unverified `contactPhone` an
 * email user types is never used to find anyone.
 */
import "server-only";

import type { OtpPurpose } from "@prisma/client";
import { getTranslations } from "next-intl/server";

import { audit } from "../audit";
import { prisma } from "../db";
import { maskEmail, normalizeEmail } from "../email-address";
import { env } from "../env";
import { loggerFor } from "../logger";
import { maskPhone, normalizeSyrianPhone } from "../phone";
import { loginChannels } from "./channels";
import { requestOtp, verifyOtp } from "./otp";
import { createSession } from "./session";

const log = loggerFor("auth/code-sign-in");

export type Channel = "phone" | "email";

export interface CodeFlowState {
  ok: boolean;
  errorKey?: string;
  errorValues?: Record<string, string | number>;
  channel?: Channel;
  /** Normalized destination (E.164 or lowercased email), carried between steps. */
  destination?: string;
  resendAfterSeconds?: number;
}

export function parseChannel(value: unknown): Channel {
  return value === "email" ? "email" : "phone";
}

/** Normalizes what the person typed, or returns the error to show. */
export function parseDestination(
  channel: Channel,
  raw: string,
): { ok: true; destination: string } | { ok: false; errorKey: string } {
  if (!loginChannels()[channel]) return { ok: false, errorKey: "auth.channelDisabled" };
  if (channel === "email") {
    const email = normalizeEmail(raw);
    return email ? { ok: true, destination: email } : { ok: false, errorKey: "emailErrors.INVALID" };
  }
  const phone = normalizeSyrianPhone(raw);
  return phone.ok ? { ok: true, destination: phone.phone } : { ok: false, errorKey: `phoneErrors.${phone.code}` };
}

const mask = (channel: Channel, destination: string) =>
  channel === "email" ? maskEmail(destination) : maskPhone(destination);

export async function sendSignInCode(params: {
  channel: Channel;
  raw: string;
  purpose: OtpPurpose;
  locale: string;
  ip: string | null;
}): Promise<CodeFlowState> {
  const { channel, purpose, locale, ip } = params;
  const parsed = parseDestination(channel, params.raw);
  if (!parsed.ok) return { ok: false, channel, errorKey: parsed.errorKey };
  const destination = parsed.destination;

  // Staff accounts sign in with a password only. Answer exactly as if a code
  // had been sent, so this form cannot be used to discover staff addresses.
  if (channel === "email") {
    const existing = await prisma.user.findUnique({ where: { email: destination }, select: { role: true } });
    if (existing?.role === "ADMIN") {
      log.warn({ to: maskEmail(destination) }, "code sign-in refused for a staff address");
      return { ok: true, channel, destination, resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
    }
  }

  const minutes = Math.round(env.OTP_TTL_SECONDS / 60);
  const tSms = await getTranslations({ locale, namespace: "otpSms" });
  const tEmail = await getTranslations({ locale, namespace: "otpEmail" });

  const result = await requestOtp(
    destination,
    purpose,
    (code) => (channel === "email" ? tEmail("body", { code, minutes }) : tSms("loginBody", { code, minutes })),
    { ip, emailSubject: tEmail("subject") },
  );

  if (!result.ok) {
    return {
      ok: false,
      channel,
      destination,
      errorKey: `otpErrors.${result.reason}`,
      errorValues: { seconds: result.retryAfterSeconds },
    };
  }

  await audit({
    action: "auth.otp.requested",
    entityType: channel,
    metadata: { to: mask(channel, destination), purpose },
    ip,
  });

  return { ok: true, channel, destination, resendAfterSeconds: result.resendAfterSeconds };
}

export type SignInResult =
  | { ok: true; userId: string; role: "CUSTOMER" | "PROVIDER" }
  | { ok: false; state: CodeFlowState };

/**
 * Verifies the code and signs the person in, creating the account on first
 * use. `contactPhone` (email sign-in only) is stored as an UNVERIFIED number
 * for providers to call.
 */
export async function completeSignIn(params: {
  channel: Channel;
  destination: string;
  code: string;
  purpose: OtpPurpose;
  ip: string | null;
  userAgent: string | null;
  contactPhone?: string;
}): Promise<SignInResult> {
  const { channel, code, purpose, ip, userAgent } = params;
  const parsed = parseDestination(channel, params.destination);
  if (!parsed.ok) return { ok: false, state: { ok: false, channel, errorKey: parsed.errorKey } };
  const destination = parsed.destination;

  const verification = await verifyOtp(destination, code.trim(), purpose, { ip });
  if (!verification.ok) {
    return {
      ok: false,
      state: {
        ok: false,
        channel,
        destination,
        errorKey: `otpErrors.${verification.reason}`,
        errorValues: verification.attemptsLeft !== undefined ? { count: verification.attemptsLeft } : undefined,
      },
    };
  }

  const now = new Date();
  const user =
    channel === "email"
      ? await prisma.user.upsert({
          where: { email: destination },
          create: {
            email: destination,
            role: "CUSTOMER",
            isEmailVerified: true,
            contactPhone: params.contactPhone ?? null,
            lastLoginAt: now,
          },
          update: {
            isEmailVerified: true,
            lastLoginAt: now,
            ...(params.contactPhone ? { contactPhone: params.contactPhone } : {}),
          },
          select: { id: true, role: true, status: true },
        })
      : await prisma.user.upsert({
          where: { phone: destination },
          create: { phone: destination, role: "CUSTOMER", isPhoneVerified: true, lastLoginAt: now },
          update: { isPhoneVerified: true, lastLoginAt: now },
          select: { id: true, role: true, status: true },
        });

  if (user.status !== "ACTIVE" || user.role === "ADMIN") {
    log.warn({ userId: user.id }, "code sign-in blocked: account not usable");
    // The same answer as a wrong code: nothing about the account leaks.
    return { ok: false, state: { ok: false, channel, destination, errorKey: "otpErrors.INVALID_CODE" } };
  }

  await createSession(user.id, false, { ip, userAgent });
  await audit({ actorId: user.id, action: "auth.otp.verified", entityType: "user", entityId: user.id, metadata: { channel }, ip });

  return { ok: true, userId: user.id, role: user.role };
}
