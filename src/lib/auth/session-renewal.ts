/**
 * When a session's expiry should slide forward. Kept free of Next.js and
 * Prisma imports so it can be unit-tested on its own.
 *
 * Every session renews while it is in use, so a provider who opens the app
 * every day never meets the login screen again; the TTL is an IDLE timeout.
 *
 * - Admin: renew past the halfway point (an 8-hour window moves with them).
 * - Customer/provider: renew at most once a day, to avoid a write on every
 *   request.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function renewalDue(remainingMs: number, ttlMs: number, isAdmin: boolean): boolean {
  if (remainingMs <= 0) return false;
  const threshold = isAdmin ? ttlMs / 2 : ttlMs - DAY_MS;
  return remainingMs <= threshold;
}

/**
 * How long the browser keeps the cookie. For customers and providers it is
 * far longer than the session itself: the database row is the authority on
 * expiry, and a server component render cannot rewrite a cookie, so the
 * cookie must outlive every renewal that happens during plain page views.
 * 400 days is the longest Chrome honours.
 */
export const LONG_COOKIE_MS = 400 * DAY_MS;

export function cookieExpiry(sessionExpiresAt: Date, isAdmin: boolean, now = Date.now()): Date {
  return isAdmin ? sessionExpiresAt : new Date(now + LONG_COOKIE_MS);
}
