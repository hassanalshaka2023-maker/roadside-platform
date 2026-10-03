import { describe, expect, it } from "vitest";

import { checkNewPassword, parseIdentifier } from "@/lib/auth/identifier";

describe("parseIdentifier", () => {
  it("reads an email, case-insensitively", () => {
    expect(parseIdentifier("  Ahmad@Gmail.com ")).toEqual({ kind: "email", value: "ahmad@gmail.com" });
  });

  it("reads a Syrian mobile number in its usual spellings", () => {
    expect(parseIdentifier("0912345678")).toEqual({ kind: "phone", value: "+963912345678" });
    expect(parseIdentifier("+963 912 345 678")).toEqual({ kind: "phone", value: "+963912345678" });
    expect(parseIdentifier("٠٩١٢٣٤٥٦٧٨")).toEqual({ kind: "phone", value: "+963912345678" });
  });

  it("rejects anything else", () => {
    expect(parseIdentifier("")).toBeNull();
    expect(parseIdentifier("ahmad@")).toBeNull();
    expect(parseIdentifier("12345")).toBeNull();
  });
});

describe("checkNewPassword", () => {
  it("needs eight characters, at most 200, typed the same twice", () => {
    expect(checkNewPassword("short", "short")).toBe("TOO_SHORT");
    expect(checkNewPassword("x".repeat(201), "x".repeat(201))).toBe("TOO_LONG");
    expect(checkNewPassword("long enough", "long enougH")).toBe("MISMATCH");
    expect(checkNewPassword("long enough", "long enough")).toBeNull();
  });
});
