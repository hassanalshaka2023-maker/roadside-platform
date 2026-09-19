/**
 * Rate limiter selection and the rules we enforce.
 *
 * Every limit is a named rule here rather than a magic number at the call
 * site, so the whole abuse surface of the app is readable in one screen.
 */
import "server-only";

import { env } from "../env";
import { MemoryRateLimiter } from "./memory";
import { PostgresRateLimiter } from "./postgres";
import type { RateLimiter, RateLimitRule } from "./types";

export * from "./types";
export { MemoryRateLimiter } from "./memory";
export { PostgresRateLimiter } from "./postgres";

const globalForLimiter = globalThis as unknown as { rateLimiter?: RateLimiter };

export const rateLimiter: RateLimiter =
  globalForLimiter.rateLimiter ??
  (env.RATE_LIMIT_DRIVER === "postgres"
    ? new PostgresRateLimiter()
    : new MemoryRateLimiter());

globalForLimiter.rateLimiter = rateLimiter;

const HOUR = 3600;
const MINUTE = 60;

export const RATE_LIMITS = {
  /** OTP codes requested for one phone number. */
  otpPerPhone: {
    limit: env.OTP_MAX_PER_PHONE_PER_HOUR,
    windowSeconds: HOUR,
  },
  /**
   * OTP codes requested from one IP. Higher than the per-phone limit because
   * whole neighbourhoods share an address here, but low enough to blunt
   * SMS-pumping fraud once a paid gateway is connected.
   */
  otpPerIp: {
    limit: env.OTP_MAX_PER_IP_PER_HOUR,
    windowSeconds: HOUR,
  },
  /** OTP verification attempts, to stop brute-forcing a six-digit code. */
  otpVerifyPerPhone: { limit: 10, windowSeconds: 15 * MINUTE },
  /** Admin login attempts per email. Complements the per-account lockout. */
  adminLoginPerEmail: { limit: 10, windowSeconds: 15 * MINUTE },
  /** Admin login attempts per IP, to stop spraying across many accounts. */
  adminLoginPerIp: { limit: 20, windowSeconds: 15 * MINUTE },
  /** Service requests created by one customer (phase 3). */
  requestCreatePerUser: { limit: 5, windowSeconds: HOUR },
  /** Provider applications from one IP (phase 4). */
  applicationPerIp: { limit: 5, windowSeconds: 24 * HOUR },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Builds a namespaced key so different limits never collide. */
export function rateLimitKey(name: RateLimitName, identifier: string): string {
  return `${name}:${identifier}`;
}

/** Convenience wrapper: consume one unit of a named limit. */
export function consumeLimit(name: RateLimitName, identifier: string) {
  return rateLimiter.consume(rateLimitKey(name, identifier), RATE_LIMITS[name]);
}
