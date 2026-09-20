/**
 * Hashing national ID numbers for duplicate detection.
 *
 * We need to notice that the same ID was submitted twice - by one person
 * applying under two phone numbers, say - without ever storing the number
 * itself. A keyed HMAC gives us that: equal numbers produce equal hashes, but
 * the hash cannot be reversed, and a stolen database alone does not let an
 * attacker test candidate ID numbers (they would need ID_HASH_SECRET too).
 *
 * Not used by any feature yet. It exists now because the column
 * (CustomerProfile.idHash, ProviderApplication.idHash) already does, and
 * because getting this wrong later would mean rehashing everything.
 */
import "server-only";

import { createHmac } from "node:crypto";

import { env } from "../env";
import { toAsciiDigits } from "../phone";

/**
 * Normalises before hashing, so the same ID typed differently still matches:
 * Arabic-Indic digits become ASCII, and everything that is not a digit
 * (spaces, dashes, letters) is dropped.
 */
export function normalizeIdNumber(raw: string): string {
  return toAsciiDigits(raw).replace(/\D/g, "");
}

export class InvalidIdNumberError extends Error {
  constructor() {
    super("ID number contains no digits");
    this.name = "InvalidIdNumberError";
  }
}

/** Hex HMAC-SHA256 of the normalised ID number. */
export function hashIdNumber(raw: string): string {
  const normalized = normalizeIdNumber(raw);
  if (normalized.length === 0) throw new InvalidIdNumberError();

  return createHmac("sha256", env.ID_HASH_SECRET)
    .update(normalized, "utf8")
    .digest("hex");
}

/** True when two ID numbers are the same after normalisation. */
export function isSameIdNumber(a: string, b: string): boolean {
  return normalizeIdNumber(a) === normalizeIdNumber(b);
}
