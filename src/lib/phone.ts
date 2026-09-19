/**
 * Syrian phone number handling.
 *
 * Pure functions, no I/O, no dependencies - so they are trivial to test and
 * safe to use on both the server and the client.
 *
 * Canonical storage format is E.164: +963 followed by the 9-digit national
 * number, e.g. +963938503705.
 *
 * Error codes rather than messages are returned, so the caller renders them
 * through next-intl. That keeps every user-facing string in messages/*.json
 * while still giving a precise reason for the rejection.
 */

export const SYRIA_COUNTRY_CODE = "963";
export const SYRIA_DIAL_PREFIX = `+${SYRIA_COUNTRY_CODE}`;

/** Length of the national significant number (without the leading zero). */
const NSN_LENGTH = 9;

/**
 * Syrian mobile numbers are 9 digits starting with 9 (local 09XXXXXXXX).
 * Deliberately permissive about the second digit: operators add prefixes over
 * time, and rejecting a real customer is worse than accepting a typo that the
 * OTP will fail on anyway.
 */
const NSN_PATTERN = /^9\d{8}$/;

export type PhoneErrorCode =
  | "EMPTY"
  | "INVALID_CHARS"
  | "NOT_SYRIAN"
  | "INVALID_LENGTH"
  | "NOT_MOBILE";

export type PhoneResult =
  | { ok: true; phone: string }
  | { ok: false; code: PhoneErrorCode };

const ARABIC_INDIC_ZERO = 0x0660; // ٠ .. ٩
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0; // ۰ .. ۹

/**
 * Converts Arabic-Indic (٠١٢٣٤٥٦٧٨٩) and Extended Arabic-Indic (۰۱۲۳۴۵۶۷۸۹)
 * digits to ASCII. Arabic keyboards on older Android phones produce these,
 * and users paste them from WhatsApp constantly.
 */
export function toAsciiDigits(input: string): string {
  let out = "";
  for (const char of input) {
    const code = char.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (
      code >= EXTENDED_ARABIC_INDIC_ZERO &&
      code <= EXTENDED_ARABIC_INDIC_ZERO + 9
    ) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    } else {
      out += char;
    }
  }
  return out;
}

/** Characters people legitimately type or paste inside a phone number. */
const ALLOWED_SEPARATORS = /[\s\-().‏‎؜]/g;

/**
 * Normalizes any format a Syrian user might type into E.164.
 *
 * Accepts: 0938503705, 938503705, +963938503705, 00963938503705,
 * 963938503705, with or without spaces, dashes, parentheses, dots and
 * bidirectional marks, in ASCII or Arabic-Indic digits.
 */
export function normalizeSyrianPhone(input: string | null | undefined): PhoneResult {
  if (input == null) return { ok: false, code: "EMPTY" };

  const cleaned = toAsciiDigits(String(input))
    .trim()
    .replace(ALLOWED_SEPARATORS, "");

  if (cleaned.length === 0) return { ok: false, code: "EMPTY" };

  // A single leading + is allowed; anything else non-numeric is a typo.
  const withoutPlus = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  if (!/^\d+$/.test(withoutPlus)) return { ok: false, code: "INVALID_CHARS" };

  let digits = withoutPlus;

  // International access prefix.
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Country code. The length guard disambiguates a real country code from a
  // local number that merely happens to start with 963 (e.g. 0963850370).
  if (digits.length > NSN_LENGTH && digits.startsWith(SYRIA_COUNTRY_CODE)) {
    digits = digits.slice(SYRIA_COUNTRY_CODE.length);
  }

  // Trunk prefix, as written locally: 09XXXXXXXX.
  if (digits.length > NSN_LENGTH && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // Anything still carrying another country code is not ours to handle.
  if (digits.length !== NSN_LENGTH) {
    return {
      ok: false,
      code: digits.length > NSN_LENGTH ? "NOT_SYRIAN" : "INVALID_LENGTH",
    };
  }

  if (!NSN_PATTERN.test(digits)) return { ok: false, code: "NOT_MOBILE" };

  return { ok: true, phone: `${SYRIA_DIAL_PREFIX}${digits}` };
}

export function isValidSyrianPhone(input: string | null | undefined): boolean {
  return normalizeSyrianPhone(input).ok;
}

/**
 * Masks a phone number for logs and for any admin screen that does not need
 * the full number: +963938503705 -> "+963 9** *** 705".
 *
 * Never throws and never leaks: anything it cannot parse becomes "***".
 * This is the only function that should ever put a phone number into a log
 * line - see the redaction config in src/lib/logger.ts.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "***";
  const result = normalizeSyrianPhone(phone);
  if (!result.ok) return "***";

  const nsn = result.phone.slice(SYRIA_DIAL_PREFIX.length);
  return `${SYRIA_DIAL_PREFIX} ${nsn[0]}** *** ${nsn.slice(6)}`;
}

/**
 * Renders a stored E.164 number the way Syrians read it: 0938503705.
 * For display only - never store this form.
 */
export function toLocalFormat(phone: string): string {
  const result = normalizeSyrianPhone(phone);
  if (!result.ok) return phone;
  return `0${result.phone.slice(SYRIA_DIAL_PREFIX.length)}`;
}
