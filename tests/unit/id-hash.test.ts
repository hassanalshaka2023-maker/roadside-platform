import { describe, expect, it } from "vitest";

import {
  hashIdNumber,
  InvalidIdNumberError,
  isSameIdNumber,
  normalizeIdNumber,
} from "@/lib/files/id-hash";

describe("normalizeIdNumber", () => {
  it("keeps only digits", () => {
    expect(normalizeIdNumber("01-02 03/04")).toBe("01020304");
  });

  it("converts Arabic-Indic digits", () => {
    expect(normalizeIdNumber("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });

  it("converts Extended Arabic-Indic digits", () => {
    expect(normalizeIdNumber("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
  });

  it("drops Arabic letters around the number", () => {
    expect(normalizeIdNumber("رقم ١٢٣٤٥")).toBe("12345");
  });

  it("drops bidirectional marks pasted from messaging apps", () => {
    expect(normalizeIdNumber("‏12345‎")).toBe("12345");
  });
});

describe("hashIdNumber", () => {
  it("returns a hex sha256-length digest", () => {
    expect(hashIdNumber("01020304050")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashIdNumber("01020304050")).toBe(hashIdNumber("01020304050"));
  });

  it("gives the SAME hash for the same number written differently", () => {
    // This is the entire purpose: catching one person applying twice.
    const plain = hashIdNumber("01020304050");

    expect(hashIdNumber("010-203-04050")).toBe(plain);
    expect(hashIdNumber(" 010 203 04050 ")).toBe(plain);
    expect(hashIdNumber("٠١٠٢٠٣٠٤٠٥٠")).toBe(plain);
  });

  it("gives different hashes for different numbers", () => {
    expect(hashIdNumber("01020304050")).not.toBe(hashIdNumber("01020304051"));
  });

  it("never contains the original number", () => {
    const id = "98765432101";
    expect(hashIdNumber(id)).not.toContain(id);
  });

  it("is keyed, not a bare sha256 - so a stolen database cannot be brute forced alone", async () => {
    const { createHash } = await import("node:crypto");
    const bare = createHash("sha256").update("01020304050", "utf8").digest("hex");

    expect(hashIdNumber("01020304050")).not.toBe(bare);
  });

  it("refuses input with no digits", () => {
    expect(() => hashIdNumber("")).toThrow(InvalidIdNumberError);
    expect(() => hashIdNumber("no digits here")).toThrow(InvalidIdNumberError);
    expect(() => hashIdNumber("---")).toThrow(InvalidIdNumberError);
  });
});

describe("isSameIdNumber", () => {
  it("compares after normalisation", () => {
    expect(isSameIdNumber("010-203-04050", "٠١٠٢٠٣٠٤٠٥٠")).toBe(true);
    expect(isSameIdNumber("01020304050", "01020304051")).toBe(false);
  });
});
