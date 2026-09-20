/**
 * Application-level file encryption: AES-256-GCM.
 *
 * Applied to EVERY file, under both storage drivers. We deliberately do not
 * rely on S3 server-side encryption alone: that protects against someone
 * stealing the provider's disks, not against the provider — or anyone with
 * bucket credentials — reading a customer's national ID.
 *
 * On-disk format (a self-contained envelope):
 *
 *   ┌────────┬─────────┬────────────┬──────────┬───────────┬────────────┐
 *   │ "RSF1" │ format  │ keyVersion │    IV    │ auth tag  │ ciphertext │
 *   │  4 B   │  1 B    │    1 B     │   12 B   │   16 B    │     ...    │
 *   └────────┴─────────┴────────────┴──────────┴───────────┴────────────┘
 *
 * The IV is random per file. The auth tag is verified on read, so any
 * tampering — a flipped bit, a truncated file, a swapped blob — fails loudly
 * rather than yielding garbage that something downstream might try to render.
 *
 * keyVersion lives in the header AND in the database row. The header makes
 * the blob self-describing; the column lets a rotation find affected files
 * without reading every object out of storage.
 */
import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "../env";

const MAGIC = Buffer.from("RSF1", "ascii");
const FORMAT_VERSION = 1;

const MAGIC_LEN = 4;
const FORMAT_LEN = 1;
const KEY_VERSION_LEN = 1;
const IV_LEN = 12; // 96 bits, the size GCM is defined for
const TAG_LEN = 16;

export const HEADER_LEN =
  MAGIC_LEN + FORMAT_LEN + KEY_VERSION_LEN + IV_LEN + TAG_LEN;

const OFFSET = {
  format: MAGIC_LEN,
  keyVersion: MAGIC_LEN + FORMAT_LEN,
  iv: MAGIC_LEN + FORMAT_LEN + KEY_VERSION_LEN,
  tag: MAGIC_LEN + FORMAT_LEN + KEY_VERSION_LEN + IV_LEN,
} as const;

export class FileDecryptionError extends Error {
  constructor(message: string) {
    super(`File decryption failed: ${message}`);
    this.name = "FileDecryptionError";
  }
}

export class UnknownKeyVersionError extends FileDecryptionError {
  constructor(version: number) {
    super(
      `no key for version ${version}. It was removed from FILE_ENCRYPTION_KEYS ` +
        `while files encrypted with it still exist. Restore that key from backup.`,
    );
    this.name = "UnknownKeyVersionError";
  }
}

/** Key ring, parsed and validated at boot by src/lib/env.ts. */
function keyFor(version: number): Buffer {
  const key = env.FILE_ENCRYPTION_KEYS.get(version);
  if (!key) throw new UnknownKeyVersionError(version);
  return key;
}

export function activeKeyVersion(): number {
  return env.FILE_ENCRYPTION_ACTIVE_VERSION;
}

/**
 * Encrypts a plaintext buffer with the currently active key.
 * Returns the complete envelope, ready to hand to a storage driver.
 */
export function encryptFile(
  plaintext: Buffer,
  keyVersion: number = activeKeyVersion(),
): Buffer {
  const key = keyFor(keyVersion);
  const iv = randomBytes(IV_LEN);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const header = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(header, 0);
  header.writeUInt8(FORMAT_VERSION, OFFSET.format);
  header.writeUInt8(keyVersion, OFFSET.keyVersion);
  iv.copy(header, OFFSET.iv);
  tag.copy(header, OFFSET.tag);

  return Buffer.concat([header, ciphertext]);
}

/**
 * Decrypts an envelope. Throws FileDecryptionError on ANY inconsistency:
 * wrong magic, unknown format, unknown key version, truncation, or a failed
 * authentication tag.
 */
export function decryptFile(envelope: Buffer): Buffer {
  if (envelope.length < HEADER_LEN) {
    throw new FileDecryptionError(
      `file is ${envelope.length} bytes, shorter than the ${HEADER_LEN}-byte header`,
    );
  }

  if (!envelope.subarray(0, MAGIC_LEN).equals(MAGIC)) {
    throw new FileDecryptionError("bad magic bytes - this is not an encrypted file");
  }

  const format = envelope.readUInt8(OFFSET.format);
  if (format !== FORMAT_VERSION) {
    throw new FileDecryptionError(`unsupported envelope format version ${format}`);
  }

  const keyVersion = envelope.readUInt8(OFFSET.keyVersion);
  const key = keyFor(keyVersion);

  const iv = envelope.subarray(OFFSET.iv, OFFSET.iv + IV_LEN);
  const tag = envelope.subarray(OFFSET.tag, OFFSET.tag + TAG_LEN);
  const ciphertext = envelope.subarray(HEADER_LEN);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM refused the tag: the file was altered, truncated, or encrypted with
    // a different key that happens to carry the same version byte.
    throw new FileDecryptionError(
      "authentication tag mismatch - the file was modified or the key is wrong",
    );
  }
}

/** Reads the key version without decrypting. Used by rotation tooling. */
export function readKeyVersion(envelope: Buffer): number {
  if (envelope.length < HEADER_LEN) {
    throw new FileDecryptionError("file is too short to contain a header");
  }
  if (!envelope.subarray(0, MAGIC_LEN).equals(MAGIC)) {
    throw new FileDecryptionError("bad magic bytes");
  }
  return envelope.readUInt8(OFFSET.keyVersion);
}
