/**
 * Rate limiting contract.
 *
 * Fixed-window counters, keyed by an arbitrary string. Fixed windows are less
 * precise than a sliding log, but they are a single row per key and a single
 * atomic statement, which is what we want on a small VPS.
 *
 * Deliberately not Redis: one fewer service to run and to secure, and our
 * expected volume (tens of requests a day at launch) is nowhere near needing
 * it. The interface exists so we can swap the driver later without touching
 * any call site.
 */

export interface RateLimitRule {
  /** Maximum number of allowed events inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** How many events are still allowed in the current window. */
  remaining: number;
  /** When the current window ends and the counter resets. */
  resetAt: Date;
}

export interface RateLimiter {
  /** Records one event against `key` and reports whether it is allowed. */
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
  /** Reports the current state without recording an event. */
  peek(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
  /** Clears a key. Used after a successful login, and in tests. */
  reset(key: string): Promise<void>;
}

/** Start of the fixed window that `now` falls into. */
export function windowStartFor(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export function buildResult(
  count: number,
  windowStart: Date,
  rule: RateLimitRule,
): RateLimitResult {
  const resetAt = new Date(windowStart.getTime() + rule.windowSeconds * 1000);
  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt,
  };
}
