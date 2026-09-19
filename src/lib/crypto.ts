/**
 * Small cryptographic helpers shared by auth, sessions and audit logging.
 *
 * Server-side only: this module reads secrets from the environment.
 */
import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import { env } from "./env";

/** Hex-encoded SHA-256. Used for session token hashes and file checksums. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Hex-encoded HMAC-SHA256 keyed by OTP_HMAC_SECRET.
 *
 * OTP codes are only six digits, so a plain hash would fall to a lookup table
 * in milliseconds. The keyed HMAC means a stolen database alone is not enough
 * to recover a code.
 */
export function hmacOtp(code: string): string {
  return createHmac("sha256", env.OTP_HMAC_SECRET).update(code, "utf8").digest("hex");
}

/**
 * Hashes an IP address before it is stored.
 *
 * We need to rate limit and to investigate abuse, but we do not need to keep
 * raw IP addresses of people asking for a tow truck. Keyed by SESSION_SECRET
 * so the hashes are not comparable across deployments.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHmac("sha256", env.SESSION_SECRET).update(ip, "utf8").digest("hex");
}

/** A cryptographically random, URL-safe token. 32 bytes by default. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * A numeric OTP code of the configured length, from a CSPRNG.
 *
 * `randomInt` is rejection-sampled by Node, so there is no modulo bias.
 * Leading zeros are preserved by padding, which keeps the code length stable.
 */
export function randomNumericCode(length: number = env.OTP_LENGTH): string {
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, "0");
}

/**
 * Constant-time string comparison.
 *
 * Both values are hashed first so that inputs of different lengths can be
 * compared without `timingSafeEqual` throwing, and so the comparison never
 * leaks the length of the secret.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = createHash("sha256").update(a, "utf8").digest();
  const bufB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(bufA, bufB);
}
