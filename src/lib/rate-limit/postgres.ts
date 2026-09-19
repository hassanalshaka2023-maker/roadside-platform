/**
 * Postgres-backed rate limiter.
 *
 * Survives restarts and is shared between app instances. The whole
 * check-and-increment is a single atomic UPSERT, so two concurrent OTP
 * requests cannot both slip past the limit by reading a stale count.
 */
import "server-only";

import { prisma } from "../db";
import {
  buildResult,
  windowStartFor,
  type RateLimiter,
  type RateLimitResult,
  type RateLimitRule,
} from "./types";

interface CounterRow {
  count: number;
  windowStart: Date;
}

export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const windowStart = windowStartFor(this.now(), rule.windowSeconds);
    const expiresAt = new Date(windowStart.getTime() + rule.windowSeconds * 1000);

    // The CASE arms roll the counter over when the stored row belongs to an
    // older window, instead of deleting and re-inserting it (which would race).
    const rows = await prisma.$queryRaw<CounterRow[]>`
      INSERT INTO "RateLimitEntry" ("key", "count", "windowStart", "expiresAt")
      VALUES (${key}, 1, ${windowStart}, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitEntry"."windowStart" < ${windowStart} THEN 1
          ELSE "RateLimitEntry"."count" + 1
        END,
        "windowStart" = CASE
          WHEN "RateLimitEntry"."windowStart" < ${windowStart} THEN ${windowStart}
          ELSE "RateLimitEntry"."windowStart"
        END,
        "expiresAt" = CASE
          WHEN "RateLimitEntry"."windowStart" < ${windowStart} THEN ${expiresAt}
          ELSE "RateLimitEntry"."expiresAt"
        END
      RETURNING "count", "windowStart";
    `;

    const row = rows[0];
    return buildResult(row.count, row.windowStart, rule);
  }

  async peek(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const windowStart = windowStartFor(this.now(), rule.windowSeconds);
    const entry = await prisma.rateLimitEntry.findUnique({ where: { key } });
    const count =
      entry && entry.windowStart.getTime() === windowStart.getTime()
        ? entry.count
        : 0;
    return buildResult(count, windowStart, rule);
  }

  async reset(key: string): Promise<void> {
    await prisma.rateLimitEntry.deleteMany({ where: { key } });
  }

  /**
   * Removes expired rows. Called by the maintenance job; the table would
   * otherwise keep one row per phone number and IP seen, forever.
   */
  async pruneExpired(): Promise<number> {
    const result = await prisma.rateLimitEntry.deleteMany({
      where: { expiresAt: { lt: this.now() } },
    });
    return result.count;
  }
}
