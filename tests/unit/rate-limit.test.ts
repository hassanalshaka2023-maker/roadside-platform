import { beforeEach, describe, expect, it } from "vitest";

import { MemoryRateLimiter } from "@/lib/rate-limit/memory";
import { windowStartFor, type RateLimitRule } from "@/lib/rate-limit/types";

const RULE: RateLimitRule = { limit: 3, windowSeconds: 60 };

/** Controllable clock, so the tests never sleep. */
function clockAt(start: number) {
  let now = start;
  return {
    get: () => new Date(now),
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
  };
}

describe("windowStartFor", () => {
  it("snaps to the start of the fixed window", () => {
    const start = windowStartFor(new Date("2026-01-01T10:00:37.500Z"), 60);
    expect(start.toISOString()).toBe("2026-01-01T10:00:00.000Z");
  });

  it("puts two times in the same window at the same start", () => {
    const a = windowStartFor(new Date("2026-01-01T10:00:01Z"), 3600);
    const b = windowStartFor(new Date("2026-01-01T10:59:59Z"), 3600);
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe("MemoryRateLimiter", () => {
  let clock: ReturnType<typeof clockAt>;
  let limiter: MemoryRateLimiter;

  beforeEach(() => {
    clock = clockAt(Date.parse("2026-01-01T10:00:00Z"));
    limiter = new MemoryRateLimiter(clock.get);
  });

  it("allows up to the limit and then refuses", async () => {
    expect((await limiter.consume("k", RULE)).allowed).toBe(true);
    expect((await limiter.consume("k", RULE)).allowed).toBe(true);

    const third = await limiter.consume("k", RULE);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    expect((await limiter.consume("k", RULE)).allowed).toBe(false);
  });

  it("counts down the remaining allowance", async () => {
    expect((await limiter.consume("k", RULE)).remaining).toBe(2);
    expect((await limiter.consume("k", RULE)).remaining).toBe(1);
    expect((await limiter.consume("k", RULE)).remaining).toBe(0);
  });

  it("keeps separate counters per key", async () => {
    await limiter.consume("a", RULE);
    await limiter.consume("a", RULE);
    await limiter.consume("a", RULE);

    expect((await limiter.consume("a", RULE)).allowed).toBe(false);
    expect((await limiter.consume("b", RULE)).allowed).toBe(true);
  });

  it("resets when the window rolls over", async () => {
    for (let i = 0; i < 4; i++) await limiter.consume("k", RULE);
    expect((await limiter.peek("k", RULE)).allowed).toBe(false);

    clock.advance(60);

    expect((await limiter.consume("k", RULE)).allowed).toBe(true);
  });

  it("does not reset partway through a window", async () => {
    for (let i = 0; i < 3; i++) await limiter.consume("k", RULE);
    clock.advance(30);
    expect((await limiter.consume("k", RULE)).allowed).toBe(false);
  });

  it("peek reports state without consuming", async () => {
    await limiter.consume("k", RULE);

    const first = await limiter.peek("k", RULE);
    const second = await limiter.peek("k", RULE);

    expect(first.remaining).toBe(2);
    expect(second.remaining).toBe(2);
  });

  it("peek on an unseen key reports the full allowance", async () => {
    expect((await limiter.peek("never-seen", RULE)).remaining).toBe(RULE.limit);
  });

  it("reset clears a key", async () => {
    for (let i = 0; i < 4; i++) await limiter.consume("k", RULE);
    expect((await limiter.peek("k", RULE)).allowed).toBe(false);

    await limiter.reset("k");

    expect((await limiter.consume("k", RULE)).allowed).toBe(true);
  });

  it("reports when the window ends", async () => {
    const result = await limiter.consume("k", RULE);
    expect(result.resetAt.toISOString()).toBe("2026-01-01T10:01:00.000Z");
  });
});
