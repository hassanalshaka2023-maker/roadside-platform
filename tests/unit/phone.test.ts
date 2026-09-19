import { describe, expect, it } from "vitest";

import {
  isValidSyrianPhone,
  maskPhone,
  normalizeSyrianPhone,
  toAsciiDigits,
  toLocalFormat,
} from "@/lib/phone";

const E164 = "+963938503705";

describe("toAsciiDigits", () => {
  it("converts Arabic-Indic digits", () => {
    expect(toAsciiDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });

  it("converts Extended Arabic-Indic (Persian) digits", () => {
    expect(toAsciiDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
  });

  it("leaves other characters untouched", () => {
    expect(toAsciiDigits("رقم ٠٩٣٨")).toBe("رقم 0938");
  });
});

describe("normalizeSyrianPhone", () => {
  it.each([
    ["local with trunk zero", "0938503705"],
    ["national significant number", "938503705"],
    ["E.164", "+963938503705"],
    ["international access prefix", "00963938503705"],
    ["country code without plus", "963938503705"],
    ["country code plus trunk zero", "9630938503705"],
  ])("normalizes %s", (_label, input) => {
    const result = normalizeSyrianPhone(input);
    expect(result).toEqual({ ok: true, phone: E164 });
  });

  it.each([
    ["spaces", " 093 850 3705 "],
    ["dashes", "093-850-3705"],
    ["parentheses and dots", "(093).850.3705"],
    ["plus with spaces", "+963 93 850 3705"],
  ])("ignores formatting: %s", (_label, input) => {
    expect(normalizeSyrianPhone(input)).toEqual({ ok: true, phone: E164 });
  });

  it("accepts Arabic-Indic digits", () => {
    expect(normalizeSyrianPhone("٠٩٣٨٥٠٣٧٠٥")).toEqual({ ok: true, phone: E164 });
  });

  it("strips bidirectional marks that WhatsApp pastes in", () => {
    expect(normalizeSyrianPhone("‏0938503705‎")).toEqual({
      ok: true,
      phone: E164,
    });
  });

  it("accepts every advertised business number", () => {
    for (const number of ["0938503705", "0992605513", "0981488760"]) {
      expect(normalizeSyrianPhone(number).ok).toBe(true);
    }
  });

  it.each([
    ["empty string", "", "EMPTY"],
    ["only separators", "   -  ", "EMPTY"],
    ["null", null, "EMPTY"],
    ["letters", "09385abc05", "INVALID_CHARS"],
    ["too short", "09385037", "INVALID_LENGTH"],
    ["foreign number", "+4915112345678", "NOT_SYRIAN"],
    ["landline, not mobile", "0113456789", "NOT_MOBILE"],
  ])("rejects %s", (_label, input, expected) => {
    const result = normalizeSyrianPhone(input as string | null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(expected);
  });

  it("is idempotent", () => {
    const once = normalizeSyrianPhone("0938503705");
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(normalizeSyrianPhone(once.phone)).toEqual({ ok: true, phone: once.phone });
  });
});

describe("isValidSyrianPhone", () => {
  it("reflects normalization", () => {
    expect(isValidSyrianPhone("0938503705")).toBe(true);
    expect(isValidSyrianPhone("not a phone")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("keeps only the first and last digits of the national number", () => {
    expect(maskPhone(E164)).toBe("+963 9** *** 705");
  });

  it("accepts any input format", () => {
    expect(maskPhone("0938503705")).toBe("+963 9** *** 705");
  });

  it("never leaks an unparseable value", () => {
    expect(maskPhone("+4915112345678")).toBe("***");
    expect(maskPhone("garbage")).toBe("***");
    expect(maskPhone(null)).toBe("***");
    expect(maskPhone(undefined)).toBe("***");
  });

  it("hides the middle digits entirely", () => {
    // The four digits in the middle must not appear anywhere in the output.
    expect(maskPhone(E164)).not.toContain("3850");
  });
});

describe("toLocalFormat", () => {
  it("renders the form Syrians read", () => {
    expect(toLocalFormat(E164)).toBe("0938503705");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(toLocalFormat("garbage")).toBe("garbage");
  });
});
