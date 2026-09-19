/**
 * Database-backed sessions.
 *
 * The cookie carries a random 32-byte token; the database stores only its
 * SHA-256. A leaked database dump therefore cannot be replayed as a login.
 *
 * Lifetimes differ by audience: an admin session is short (8 hours, renewed
 * while in use) because an admin can read ID documents; customers and
 * providers get 30 days because re-authenticating by SMS on a bad connection
 * at the roadside is exactly the wrong moment to ask for a code.
 */
import "server-only";

import { cookies } from "next/headers";

import { sha256, randomToken, hashIp } from "../crypto";
import { prisma } from "../db";
import { env, isProduction } from "../env";
import { loggerFor } from "../logger";

const log = loggerFor("auth/session");

export const SESSION_COOKIE = "rs_session";

export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

function ttlMsFor(isAdmin: boolean): number {
  return isAdmin
    ? env.SESSION_TTL_ADMIN_HOURS * 60 * 60 * 1000
    : env.SESSION_TTL_CUSTOMER_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Creates a session row and sets the cookie.
 *
 * SameSite=Lax rather than Strict: a customer following a tracking link from
 * WhatsApp is a top-level GET navigation, which Lax allows and Strict would
 * break. Mutations are protected by the Origin check in ./csrf.ts instead.
 */
export async function createSession(
  userId: string,
  isAdmin: boolean,
  context: SessionContext = {},
): Promise<void> {
  const token = randomToken(32);
  const ttl = ttlMsFor(isAdmin);
  const expiresAt = new Date(Date.now() + ttl);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      userAgent: context.userAgent?.slice(0, 512) ?? null,
      ipHash: hashIp(context.ip),
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  log.info({ userId, isAdmin }, "session created");
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}

/**
 * Looks up the session behind the current cookie.
 *
 * Returns null for a missing, unknown, revoked or expired token. Expired rows
 * are left in place for the retention job rather than deleted here, so a
 * read never turns into a write on the hot path.
 */
export async function readSessionFromCookie(): Promise<ActiveSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  return {
    sessionId: session.id,
    userId: session.userId,
    expiresAt: session.expiresAt,
  };
}

/**
 * Sliding renewal for admin sessions: while an admin keeps working, the
 * 8-hour window moves with them; once they stop, it expires on schedule.
 * Only extends past the halfway point, to avoid a write on every request.
 */
export async function touchSession(
  session: ActiveSession,
  isAdmin: boolean,
): Promise<void> {
  if (!isAdmin) return;

  const ttl = ttlMsFor(true);
  const remaining = session.expiresAt.getTime() - Date.now();
  if (remaining > ttl / 2) return;

  const expiresAt = new Date(Date.now() + ttl);
  await prisma.session.update({
    where: { id: session.sessionId },
    data: { expiresAt },
  });

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    cookieStore.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  }
}

/** Revokes the current session and clears the cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Revokes every session a user has.
 *
 * Used on password change, on suspension, and whenever an admin's level
 * changes - a privilege change must not wait for an old cookie to expire.
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  log.warn({ userId, count: result.count }, "all sessions revoked");
  return result.count;
}

/** Maintenance: drop rows that are long expired. Called by the retention job. */
export async function pruneExpiredSessions(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
