/**
 * What someone types into "email or phone", and the password rules.
 * Pure, so the parsing rules can be unit-tested and shared with the client.
 */
import { normalizeEmail } from "../email-address";
import { normalizeSyrianPhone } from "../phone";

export type Identifier = { kind: "email"; value: string } | { kind: "phone"; value: string };

/** An "@" means email; anything else must be a Syrian mobile number. */
export function parseIdentifier(raw: string): Identifier | null {
  const trimmed = raw.trim();
  if (trimmed.includes("@")) {
    const email = normalizeEmail(trimmed);
    return email ? { kind: "email", value: email } : null;
  }
  const phone = normalizeSyrianPhone(trimmed);
  return phone.ok ? { kind: "phone", value: phone.phone } : null;
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export type PasswordProblem = "TOO_SHORT" | "TOO_LONG" | "MISMATCH";

/** Length is the rule that matters; no forced symbol soup people forget. */
export function checkNewPassword(password: string, confirm: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN) return "TOO_SHORT";
  if (password.length > PASSWORD_MAX) return "TOO_LONG";
  if (password !== confirm) return "MISMATCH";
  return null;
}
