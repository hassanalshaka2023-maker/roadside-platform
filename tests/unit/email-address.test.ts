import { describe, expect, it } from "vitest";

import { isEmailDestination, maskEmail, normalizeEmail } from "@/lib/email-address";

describe("normalizeEmail", () => {
  it("trims and lowercases a valid address", () => {
    expect(normalizeEmail("  Ahmad.Ali@Gmail.COM ")).toBe("ahmad.ali@gmail.com");
  });

  it("rejects things that are not addresses", () => {
    for (const bad of ["", "ahmad", "ahmad@", "@gmail.com", "a b@gmail.com", "ahmad@gmail", "0938503705"]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });
});

describe("helpers", () => {
  it("tells an email destination from a phone number", () => {
    expect(isEmailDestination("a@b.co")).toBe(true);
    expect(isEmailDestination("+963938503705")).toBe(false);
  });

  it("masks the address for logs and screens", () => {
    expect(maskEmail("ahmad@gmail.com")).toBe("a***@gmail.com");
    expect(maskEmail("broken")).toBe("***");
  });
});
