/**
 * Storage contract.
 *
 * The bytes that reach a driver are ALREADY encrypted by
 * src/lib/files/crypto.ts, so a driver never handles readable ID documents.
 * That is deliberate: the disk, the bucket and whoever operates them are all
 * treated as untrusted.
 *
 * Keys are random UUIDs - never a client filename, never anything derived
 * from user input.
 */

/** A storage key is exactly a UUID v4, nothing else. */
const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    // The key itself is not echoed: it would end up in a log line.
    super(`Invalid storage key (expected a UUID, got ${key.length} characters)`);
    this.name = "InvalidStorageKeyError";
  }
}

export class StorageObjectNotFoundError extends Error {
  constructor() {
    super("Storage object not found");
    this.name = "StorageObjectNotFoundError";
  }
}

/**
 * The single gate every driver must pass a key through.
 *
 * A UUID cannot contain `/`, `\`, `..`, a drive letter or a NUL byte, so path
 * traversal is impossible by construction rather than by sanitising.
 */
export function assertValidStorageKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new InvalidStorageKeyError(key);
}

export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export interface StorageDriver {
  readonly name: string;
  /** Writes (or overwrites) an object. Must be atomic. */
  put(key: string, data: Buffer): Promise<void>;
  /** Reads an object. Throws StorageObjectNotFoundError when absent. */
  get(key: string): Promise<Buffer>;
  /** Removes an object. Succeeds silently when it is already gone. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
