import "server-only";

import { env } from "../env";
import { LocalDiskDriver } from "./local";
import { S3Driver } from "./s3";
import type { StorageDriver } from "./types";

export * from "./types";
export { LocalDiskDriver, UnsafeUploadsDirError, assertUploadsDirIsSafe } from "./local";
export { S3Driver } from "./s3";

const globalForStorage = globalThis as unknown as { storage?: StorageDriver };

function createDriver(): StorageDriver {
  if (env.STORAGE_DRIVER === "s3") {
    return new S3Driver({
      // env validation guarantees these are present when the driver is s3.
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  // The constructor validates the directory and throws if it is unsafe, so a
  // misconfigured UPLOADS_DIR fails at startup rather than at first upload.
  return new LocalDiskDriver(env.UPLOADS_DIR!);
}

/** Singleton, for the same reason the Prisma client is one: dev HMR. */
export const storage: StorageDriver = globalForStorage.storage ?? createDriver();

globalForStorage.storage = storage;
