/**
 * S3-compatible driver for production.
 *
 * ============================================================================
 * UNTESTED. There was no S3-compatible bucket available on the machine this
 * was written on, so this code has never executed against a real endpoint.
 * Verify it against the actual bucket before the first deployment.
 * ============================================================================
 *
 * The AWS SDK is imported LAZILY, inside the first call, so development on the
 * local driver never pays to load it.
 *
 * Note that the bytes handed to this driver are already encrypted by the
 * application. Server-side encryption at the provider is welcome on top, but
 * we deliberately do not depend on it: the bucket operator should not be able
 * to read a customer's ID document.
 */
import "server-only";

import { loggerFor } from "../logger";
import {
  assertValidStorageKey,
  StorageObjectNotFoundError,
  type StorageDriver,
} from "./types";

const log = loggerFor("storage/s3");

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

// Minimal structural types, so this module does not need the SDK's types at
// compile time (it is an optional runtime dependency in spirit).
interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

export class S3Driver implements StorageDriver {
  readonly name = "s3";
  private client: S3ClientLike | null = null;
  private commands: Record<string, new (input: unknown) => unknown> | null = null;

  constructor(private readonly config: S3Config) {}

  /** Loads the SDK once, on first use. */
  private async sdk() {
    if (this.client && this.commands) {
      return { client: this.client, commands: this.commands };
    }

    const {
      S3Client,
      PutObjectCommand,
      GetObjectCommand,
      DeleteObjectCommand,
      HeadObjectCommand,
    } = await import("@aws-sdk/client-s3");

    this.client = new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    }) as unknown as S3ClientLike;

    this.commands = {
      PutObjectCommand,
      GetObjectCommand,
      DeleteObjectCommand,
      HeadObjectCommand,
    } as unknown as Record<string, new (input: unknown) => unknown>;

    log.info({ endpoint: this.config.endpoint }, "s3 client initialised");
    return { client: this.client, commands: this.commands };
  }

  async put(key: string, data: Buffer): Promise<void> {
    assertValidStorageKey(key);
    const { client, commands } = await this.sdk();

    await client.send(
      new commands.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        // The payload is our own ciphertext; the type is deliberately opaque
        // so nothing downstream tries to render it.
        ContentType: "application/octet-stream",
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertValidStorageKey(key);
    const { client, commands } = await this.sdk();

    try {
      const response = (await client.send(
        new commands.GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };

      if (!response.Body) throw new StorageObjectNotFoundError();
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) throw new StorageObjectNotFoundError();
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    const { client, commands } = await this.sdk();

    try {
      await client.send(
        new commands.DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
    } catch (error) {
      // Deleting something already gone is the desired end state.
      if (!isNotFound(error)) throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    assertValidStorageKey(key);
    const { client, commands } = await this.sdk();

    try {
      await client.send(
        new commands.HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}
