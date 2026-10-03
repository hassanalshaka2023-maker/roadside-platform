import { describe, expect, it } from "vitest";

import { LONG_COOKIE_MS, cookieExpiry, renewalDue } from "@/lib/auth/session-renewal";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("renewalDue", () => {
  it("renews a customer/provider session once it is a day old", () => {
    const ttl = 30 * DAY;
    expect(renewalDue(ttl - HOUR, ttl, false)).toBe(false);
    expect(renewalDue(ttl - DAY, ttl, false)).toBe(true);
    expect(renewalDue(5 * DAY, ttl, false)).toBe(true);
  });

  it("renews an admin session only past the halfway point", () => {
    const ttl = 8 * HOUR;
    expect(renewalDue(5 * HOUR, ttl, true)).toBe(false);
    expect(renewalDue(4 * HOUR, ttl, true)).toBe(true);
  });

  it("never revives an expired session", () => {
    expect(renewalDue(0, 30 * DAY, false)).toBe(false);
    expect(renewalDue(-HOUR, 8 * HOUR, true)).toBe(false);
  });
});

describe("cookieExpiry", () => {
  const now = Date.UTC(2026, 9, 3);
  const sessionEnd = new Date(now + 8 * HOUR);

  it("ties an admin cookie to the session", () => {
    expect(cookieExpiry(sessionEnd, true, now)).toEqual(sessionEnd);
  });

  it("lets a customer/provider cookie outlive the session", () => {
    expect(cookieExpiry(sessionEnd, false, now).getTime()).toBe(now + LONG_COOKIE_MS);
  });
});
