/**
 * Email-or-phone + password sign-in for providers (and any customer who chose
 * to set a password), plus "forgot password" by one-time code.
 *
 * Same defences as the admin login (./admin-login.ts):
 *   - one generic failure for unknown account, wrong password, no password
 *     set, suspended account - and an unknown account still burns a hash
 *   - rate limits per identifier and per IP
 *   - a temporary lockout after repeated wrong passwords
 *
 * Phone sign-in looks at the VERIFIED `phone` column only, never at the
 * unverified `contactPhone` (see the schema).
 *
 * Staff accounts never sign in here: they have their own page.
 */
import "server-only";

import { getTranslations } from "next-intl/server";

import { audit } from "../audit";
import { prisma } from "../db";
import { maskEmail } from "../email-address";
import { env } from "../env";
import { loggerFor } from "../logger";
import { maskPhone } from "../phone";
import { consumeLimit } from "../rate-limit";
import { computeLockout, isLockedOut } from "./admin-login";
import { loginChannels } from "./channels";
import { checkNewPassword, parseIdentifier, type Identifier, type PasswordProblem } from "./identifier";
import { requestOtp, verifyOtp } from "./otp";
import { fakeVerifyPassword, hashPassword, verifyPassword } from "./password";
import { createSession, revokeAllUserSessions } from "./session";

const log = loggerFor("auth/password-login");

const whereFor = (id: Identifier) => (id.kind === "email" ? { email: id.value } : { phone: id.value });
const maskId = (id: Identifier) => (id.kind === "email" ? maskEmail(id.value) : maskPhone(id.value));
const secondsUntil = (date: Date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export type PasswordLoginResult =
  | { ok: true; userId: string; role: "CUSTOMER" | "PROVIDER" }
  | { ok: false; reason: "INVALID_CREDENTIALS" | "LOCKED" | "RATE_LIMITED"; retryAfterSeconds?: number };

export async function passwordLogin(
  rawIdentifier: string,
  password: string,
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<PasswordLoginResult> {
  const id = parseIdentifier(rawIdentifier);
  const key = id ? `${id.kind}:${id.value}` : `raw:${rawIdentifier.trim().toLowerCase().slice(0, 100)}`;

  const perId = await consumeLimit("passwordLoginPerIdentifier", key);
  if (!perId.allowed) return { ok: false, reason: "RATE_LIMITED", retryAfterSeconds: secondsUntil(perId.resetAt) };
  if (context.ip) {
    const perIp = await consumeLimit("passwordLoginPerIp", context.ip);
    if (!perIp.allowed) return { ok: false, reason: "RATE_LIMITED", retryAfterSeconds: secondsUntil(perIp.resetAt) };
  }

  const user = id
    ? await prisma.user.findUnique({
        where: whereFor(id),
        select: {
          id: true,
          role: true,
          status: true,
          deletedAt: true,
          passwordHash: true,
          failedLoginCount: true,
          lockedUntil: true,
        },
      })
    : null;

  const usable =
    user !== null &&
    user.role !== "ADMIN" &&
    user.status === "ACTIVE" &&
    user.deletedAt === null &&
    user.passwordHash !== null;

  if (!usable) {
    await fakeVerifyPassword(password);
    log.warn({ kind: id?.kind ?? "invalid" }, "password login failed: no usable account");
    await audit({ action: "auth.password.login.failure", entityType: "user", metadata: { reason: "no_usable_account" }, ip: context.ip });
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  if (isLockedOut(user.lockedUntil)) {
    return { ok: false, reason: "LOCKED", retryAfterSeconds: secondsUntil(user.lockedUntil!) };
  }

  if (!(await verifyPassword(user.passwordHash!, password))) {
    const lockout = computeLockout(user.failedLoginCount);
    await prisma.user.update({ where: { id: user.id }, data: lockout });
    await audit({
      actorId: user.id,
      action: "auth.password.login.failure",
      entityType: "user",
      entityId: user.id,
      metadata: { failedLoginCount: lockout.failedLoginCount, locked: lockout.lockedUntil !== null },
      ip: context.ip,
    });
    // Not "LOCKED" even if this attempt locked it: that would confirm the account.
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(user.id, false, context);
  await audit({ actorId: user.id, action: "auth.password.login.success", entityType: "user", entityId: user.id, metadata: { kind: id!.kind }, ip: context.ip });

  return { ok: true, userId: user.id, role: user.role as "CUSTOMER" | "PROVIDER" };
}

// ---------------------------------------------------------------------------
// Set / change (signed in)
// ---------------------------------------------------------------------------

export type SetPasswordResult = { ok: true } | { ok: false; reason: PasswordProblem | "WRONG_CURRENT" };

/**
 * Sets the signed-in user's password. Someone who already has one must
 * give it; someone who has none (they just proved their email/phone with a
 * code) sets one directly. Other devices are signed out on a change.
 */
export async function setOwnPassword(params: {
  userId: string;
  currentPassword?: string;
  password: string;
  confirm: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<SetPasswordResult> {
  const problem = checkNewPassword(params.password, params.confirm);
  if (problem) return { ok: false, reason: problem };

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { passwordHash: true, role: true },
  });
  if (user.role === "ADMIN") throw new Error("staff change their password at /admin/account");

  const changing = user.passwordHash !== null;
  if (changing && !(await verifyPassword(user.passwordHash!, params.currentPassword ?? ""))) {
    return { ok: false, reason: "WRONG_CURRENT" };
  }

  await prisma.user.update({
    where: { id: params.userId },
    data: { passwordHash: await hashPassword(params.password), failedLoginCount: 0, lockedUntil: null },
  });

  if (changing) {
    // A changed password must lock out whoever else might be signed in.
    await revokeAllUserSessions(params.userId);
    await createSession(params.userId, false, params);
  }

  await audit({ actorId: params.userId, action: "auth.password.set", entityType: "user", entityId: params.userId, metadata: { changing }, ip: params.ip });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

export type ResetRequestResult =
  | { ok: true; identifier: Identifier; resendAfterSeconds: number }
  | { ok: false; errorKey: string; errorValues?: Record<string, number> };

/**
 * Sends a reset code - but only to an existing customer/provider account.
 * For anything else the answer is identical and nothing is sent, so this
 * form cannot be used to discover who has an account.
 */
export async function requestPasswordReset(params: {
  raw: string;
  locale: string;
  ip: string | null;
}): Promise<ResetRequestResult> {
  const id = parseIdentifier(params.raw);
  if (!id) return { ok: false, errorKey: "passwordAuth.invalidIdentifier" };
  if (!loginChannels()[id.kind]) return { ok: false, errorKey: "auth.channelDisabled" };

  const pretendSent: ResetRequestResult = { ok: true, identifier: id, resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };

  const user = await prisma.user.findUnique({
    where: whereFor(id),
    select: { id: true, role: true, status: true, deletedAt: true },
  });
  if (!user || user.role === "ADMIN" || user.status !== "ACTIVE" || user.deletedAt !== null) {
    log.info({ to: maskId(id) }, "password reset requested for no usable account");
    return pretendSent;
  }

  const minutes = Math.round(env.OTP_TTL_SECONDS / 60);
  const t = await getTranslations({ locale: params.locale, namespace: "passwordAuth" });
  const result = await requestOtp(
    id.value,
    "PASSWORD_RESET",
    (code) => (id.kind === "email" ? t("resetEmailBody", { code, minutes }) : t("resetSmsBody", { code, minutes })),
    { ip: params.ip, emailSubject: t("resetEmailSubject") },
  );
  if (!result.ok) {
    return { ok: false, errorKey: `otpErrors.${result.reason}`, errorValues: { seconds: result.retryAfterSeconds } };
  }

  await audit({ actorId: user.id, action: "auth.otp.requested", entityType: id.kind, metadata: { to: maskId(id), purpose: "PASSWORD_RESET" }, ip: params.ip });
  return { ok: true, identifier: id, resendAfterSeconds: result.resendAfterSeconds };
}

export type ResetCompleteResult =
  | { ok: true; role: "CUSTOMER" | "PROVIDER" }
  | { ok: false; errorKey: string; errorValues?: Record<string, number> };

/**
 * Checks the code, sets the new password, signs out every other device and
 * signs this one in. Clears any lockout: proving the email/phone is stronger
 * than guessing a password.
 */
export async function completePasswordReset(params: {
  raw: string;
  code: string;
  password: string;
  confirm: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<ResetCompleteResult> {
  const id = parseIdentifier(params.raw);
  if (!id) return { ok: false, errorKey: "passwordAuth.invalidIdentifier" };

  const problem = checkNewPassword(params.password, params.confirm);
  if (problem) return { ok: false, errorKey: `passwordAuth.problem.${problem}` };

  const verification = await verifyOtp(id.value, params.code.trim(), "PASSWORD_RESET", { ip: params.ip });
  if (!verification.ok) {
    return {
      ok: false,
      errorKey: `otpErrors.${verification.reason}`,
      errorValues: verification.attemptsLeft !== undefined ? { count: verification.attemptsLeft } : undefined,
    };
  }

  const user = await prisma.user.findUnique({
    where: whereFor(id),
    select: { id: true, role: true, status: true, deletedAt: true },
  });
  // A code is only ever sent to a usable account, but the account may have
  // been suspended in the five minutes since.
  if (!user || user.role === "ADMIN" || user.status !== "ACTIVE" || user.deletedAt !== null) {
    return { ok: false, errorKey: "otpErrors.INVALID_CODE" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(params.password),
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(id.kind === "email" ? { isEmailVerified: true } : { isPhoneVerified: true }),
    },
  });
  await revokeAllUserSessions(user.id);
  await createSession(user.id, false, params);
  await audit({ actorId: user.id, action: "auth.password.reset", entityType: "user", entityId: user.id, metadata: { kind: id.kind }, ip: params.ip });

  return { ok: true, role: user.role as "CUSTOMER" | "PROVIDER" };
}
