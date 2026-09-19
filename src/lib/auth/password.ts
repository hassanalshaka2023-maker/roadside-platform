/**
 * Password hashing for admin accounts.
 *
 * Uses @node-rs/argon2 rather than the `argon2` package: same argon2id
 * algorithm, but shipped as prebuilt binaries, so the Docker image does not
 * need a C toolchain and does not break on musl.
 */
import "server-only";

import { hash, verify, type Algorithm } from "@node-rs/argon2";

/**
 * Algorithm.Argon2id.
 *
 * Inlined rather than referenced through the enum: @node-rs/argon2 declares
 * it as an ambient `const enum`, which cannot be read under the
 * `isolatedModules` compilation that Next.js requires.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane).
 * Tuned for a small VPS: high enough to be expensive for an attacker,
 * low enough that a login does not stall the event loop.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    // A malformed or truncated hash in the database must read as "wrong
    // password", never as an exception that reveals the account exists.
    return false;
  }
}

/**
 * A dummy hash used to burn the same CPU time when the account does not
 * exist. Without it, "unknown email" would return in microseconds while
 * "wrong password" took ~50ms, and that difference is a user-enumeration
 * oracle - which the security rules explicitly forbid.
 */
let dummyHash: Promise<string> | null = null;

export async function fakeVerifyPassword(plain: string): Promise<false> {
  dummyHash ??= hashPassword("not-a-real-password-placeholder");
  await verifyPassword(await dummyHash, plain);
  return false;
}
