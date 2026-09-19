/**
 * In-process rate limiter.
 *
 * For development and tests only. Counters live in this process's memory, so
 * they are lost on restart and are not shared between instances - which is
 * exactly why production uses the Postgres driver instead.
 */
import {
  buildResult,
  windowStartFor,
  type RateLimiter,
  type RateLimitResult,
  type RateLimitRule,
} from "./types";

interface Bucket {
  count: number;
  windowStart: number;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /** Injectable clock so tests can move time without sleeping. */
  constructor(private readonly now: () => Date = () => new Date()) {}

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const start = windowStartFor(this.now(), rule.windowSeconds).getTime();
    const existing = this.buckets.get(key);

    const bucket: Bucket =
      existing && existing.windowStart === start
        ? { count: existing.count + 1, windowStart: start }
        : { count: 1, windowStart: start };

    this.buckets.set(key, bucket);
    this.prune(start);

    return buildResult(bucket.count, new Date(start), rule);
  }

  async peek(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const start = windowStartFor(this.now(), rule.windowSeconds).getTime();
    const existing = this.buckets.get(key);
    const count = existing && existing.windowStart === start ? existing.count : 0;
    return buildResult(count, new Date(start), rule);
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /** Test helper. */
  clear(): void {
    this.buckets.clear();
  }

  /**
   * Drops buckets from older windows so a long-running dev server does not
   * grow a map entry per phone number seen since boot.
   */
  private prune(currentWindowStart: number): void {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStart < currentWindowStart) this.buckets.delete(key);
    }
  }
}
