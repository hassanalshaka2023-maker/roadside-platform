import { describe, expect, it } from "vitest";

import { computeLockout, isLockedOut } from "@/lib/auth/admin-login";

const NOW = new Date("2026-01-01T10:00:00Z");

describe("computeLockout", () => {
  it("counts a failure without locking below the threshold", () => {
    const result = computeLockout(0, NOW, 5, 15);
    expect(result.failedLoginCount).toBe(1);
    expect(result.lockedUntil).toBeNull();
  });

  it("does not lock on the fourth failure", () => {
    expect(computeLockout(3, NOW, 5, 15).lockedUntil).toBeNull();
  });

  it("locks on the fifth failure", () => {
    const result = computeLockout(4, NOW, 5, 15);
    expect(result.failedLoginCount).toBe(5);
    expect(result.lockedUntil?.toISOString()).toBe("2026-01-01T10:15:00.000Z");
  });

  it("keeps locking on further failures while locked", () => {
    const result = computeLockout(9, NOW, 5, 15);
    expect(result.failedLoginCount).toBe(10);
    expect(result.lockedUntil).not.toBeNull();
  });

  it("honours a custom threshold and duration", () => {
    const result = computeLockout(2, NOW, 3, 30);
    expect(result.lockedUntil?.toISOString()).toBe("2026-01-01T10:30:00.000Z");
  });
});

describe("isLockedOut", () => {
  it("is false when there is no lock", () => {
    expect(isLockedOut(null, NOW)).toBe(false);
    expect(isLockedOut(undefined, NOW)).toBe(false);
  });

  it("is true while the lock is in the future", () => {
    expect(isLockedOut(new Date("2026-01-01T10:05:00Z"), NOW)).toBe(true);
  });

  it("is false once the lock has passed", () => {
    expect(isLockedOut(new Date("2026-01-01T09:59:59Z"), NOW)).toBe(false);
  });

  it("is false exactly at expiry, so the user is not locked out a second longer", () => {
    expect(isLockedOut(NOW, NOW)).toBe(false);
  });
});
