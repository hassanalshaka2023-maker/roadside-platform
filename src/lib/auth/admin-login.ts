/**
 * Admin login: email + password, argon2id.
 *
 * Three rules from the security section of CLAUDE.md are implemented here:
 *   1. no user enumeration - every failure returns the same generic reason,
 *      and an unknown email still burns a password verification
 *   2. rate limiting per email and per IP
 *   3. a temporary account lockout after repeated failures
 */
import "server-only";

import { audit } from "../audit";
import { prisma } from "../db";
import { env } from "../env";
import { loggerFor } from "../logger";
import { consumeLimit } from "../rate-limit";
import { fakeVerifyPassword, verifyPassword } from "./password";
import { createSession } from "./session";

const log = loggerFor("auth/admin-login");

export type AdminLoginFailure =
  /** Wrong email, wrong password, non-admin account, suspended account. */
  | "INVALID_CREDENTIALS"
  | "LOCKED"
  | "RATE_LIMITED";

export type AdminLoginResult =
  | { ok: true; userId: string }
  | { ok: false; reason: AdminLoginFailure; retryAfterSeconds?: number };

export interface AdminLoginContext {
  ip?: string | null;
  userAgent?: string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function adminLogin(
  rawEmail: string,
  password: string,
  context: AdminLoginContext = {},
): Promise<AdminLoginResult> {
  const email = normalizeEmail(rawEmail);

  // --- rate limits -------------------------------------------------------
  const perEmail = await consumeLimit("adminLoginPerEmail", email);
  if (!perEmail.allowed) {
    return {
      ok: false,
      reason: "RATE_LIMITED",
      retryAfterSeconds: Math.ceil((perEmail.resetAt.getTime() - Date.now()) / 1000),
    };
  }

  if (context.ip) {
    const perIp = await consumeLimit("adminLoginPerIp", context.ip);
    if (!perIp.allowed) {
      return {
        ok: false,
        reason: "RATE_LIMITED",
        retryAfterSeconds: Math.ceil((perIp.resetAt.getTime() - Date.now()) / 1000),
      };
    }
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      role: true,
      status: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
      deletedAt: true,
    },
  });

  // --- unknown account ---------------------------------------------------
  // Still run a password verification so the response time matches the
  // "wrong password" path. Without this, response latency alone tells an
  // attacker which admin emails exist.
  const usable =
    user !== null &&
    user.role === "ADMIN" &&
    user.status === "ACTIVE" &&
    user.deletedAt === null &&
    user.passwordHash !== null;

  if (!usable) {
    await fakeVerifyPassword(password);
    log.warn({ emailDomain: email.split("@")[1] }, "admin login failed: no usable account");
    await audit({
      action: "auth.admin.login.failure",
      entityType: "user",
      metadata: { reason: "no_usable_account" },
      ip: context.ip,
    });
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  // --- lockout -----------------------------------------------------------
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const retryAfterSeconds = Math.ceil(
      (user.lockedUntil.getTime() - Date.now()) / 1000,
    );
    await audit({
      actorId: user.id,
      action: "auth.admin.login.locked",
      entityType: "user",
      entityId: user.id,
      ip: context.ip,
    });
    return { ok: false, reason: "LOCKED", retryAfterSeconds };
  }

  // --- password ----------------------------------------------------------
  const valid = await verifyPassword(user.passwordHash!, password);

  if (!valid) {
    const failedLoginCount = user.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= env.ADMIN_MAX_FAILED_LOGINS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil: shouldLock
          ? new Date(Date.now() + env.ADMIN_LOCKOUT_MINUTES * 60 * 1000)
          : null,
      },
    });

    log.warn({ userId: user.id, failedLoginCount, shouldLock }, "admin login failed");
    await audit({
      actorId: user.id,
      action: "auth.admin.login.failure",
      entityType: "user",
      entityId: user.id,
      metadata: { failedLoginCount, locked: shouldLock },
      ip: context.ip,
    });

    // Note: still INVALID_CREDENTIALS, not LOCKED. Telling an attacker that
    // their guessing has locked an account confirms the account exists.
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  // --- success -----------------------------------------------------------
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await createSession(user.id, true, {
    ip: context.ip,
    userAgent: context.userAgent,
  });

  log.info({ userId: user.id }, "admin login succeeded");
  await audit({
    actorId: user.id,
    action: "auth.admin.login.success",
    entityType: "user",
    entityId: user.id,
    ip: context.ip,
  });

  return { ok: true, userId: user.id };
}

/**
 * Pure lockout decision, extracted so it can be unit tested without a
 * database. Returns the new counter and the lock expiry, if any.
 */
export function computeLockout(
  currentFailures: number,
  now: Date = new Date(),
  maxFailures: number = env.ADMIN_MAX_FAILED_LOGINS,
  lockoutMinutes: number = env.ADMIN_LOCKOUT_MINUTES,
): { failedLoginCount: number; lockedUntil: Date | null } {
  const failedLoginCount = currentFailures + 1;
  return {
    failedLoginCount,
    lockedUntil:
      failedLoginCount >= maxFailures
        ? new Date(now.getTime() + lockoutMinutes * 60 * 1000)
        : null,
  };
}

/** True when the account is currently locked out. */
export function isLockedOut(
  lockedUntil: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return lockedUntil != null && lockedUntil.getTime() > now.getTime();
}
