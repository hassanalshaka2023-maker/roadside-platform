/**
 * File service: the only place that combines storage, encryption, image
 * processing, scanning and the database.
 *
 * Route handlers do authentication, authorization and rate limiting, then
 * call in here. Nothing in this module reads cookies or headers, which keeps
 * it testable and keeps the security boundary visible in the routes.
 *
 * Logging rule: file IDs only. Never a filename, never contents, never a
 * storage key (the logger redacts `storageKey` anyway).
 */
import "server-only";

import { randomUUID } from "node:crypto";

import type { FileKind, Prisma } from "@prisma/client";

import { audit, auditStrict } from "../audit";
import { sha256 } from "../crypto";
import { prisma } from "../db";
import { env } from "../env";
import { loggerFor } from "../logger";
import { storage, StorageObjectNotFoundError } from "../storage";
import { decryptFile, encryptFile, activeKeyVersion } from "./crypto";
import { processUploadedImage, type ImageErrorCode } from "./image";
import { fileScanner } from "./scanner";

const log = loggerFor("files/service");

export type UploadFailureCode = ImageErrorCode | "QUOTA_FILES" | "QUOTA_BYTES" | "INFECTED";

export class UploadRejectedError extends Error {
  constructor(readonly code: UploadFailureCode, detail?: string) {
    super(`Upload rejected (${code})${detail ? `: ${detail}` : ""}`);
    this.name = "UploadRejectedError";
  }
}

export class FileNotFoundError extends Error {
  constructor() {
    super("File not found");
    this.name = "FileNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

export interface QuotaUsage {
  files: number;
  bytes: number;
  maxFiles: number;
  maxBytes: number;
}

/** Rolling 24-hour usage for one user. */
export async function getQuotaUsage(userId: string): Promise<QuotaUsage> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await prisma.uploadedFile.aggregate({
    where: { ownerId: userId, createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });

  return {
    files: result._count._all,
    bytes: result._sum.sizeBytes ?? 0,
    maxFiles: env.UPLOAD_MAX_FILES_PER_DAY,
    maxBytes: env.UPLOAD_MAX_BYTES_PER_DAY,
  };
}

/**
 * Deleted files still count. Otherwise deleting and re-uploading would be a
 * free way around the quota, and the cost we are limiting (decode, encrypt,
 * write) has already been paid.
 */
async function assertWithinQuota(userId: string, incomingBytes: number): Promise<void> {
  const usage = await getQuotaUsage(userId);

  if (usage.files >= usage.maxFiles) {
    throw new UploadRejectedError("QUOTA_FILES", `${usage.files}/${usage.maxFiles}`);
  }

  if (usage.bytes + incomingBytes > usage.maxBytes) {
    throw new UploadRejectedError("QUOTA_BYTES", `${usage.bytes}+${incomingBytes}`);
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadInput {
  ownerId: string;
  kind: FileKind;
  /** Raw bytes as received. Already capped at UPLOAD_MAX_BYTES by the caller. */
  data: Buffer;
  ip?: string | null;
}

export interface UploadedFileSummary {
  id: string;
  kind: FileKind;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: Date;
}

/**
 * The full pipeline: validate, re-encode, scan, encrypt, store, record.
 *
 * Order matters. The bytes are re-encoded BEFORE they are scanned or stored,
 * so whatever lands in storage is an image we produced ourselves, not
 * something the client sent.
 */
export async function uploadFile(input: UploadInput): Promise<UploadedFileSummary> {
  await assertWithinQuota(input.ownerId, input.data.length);

  // Throws ImageProcessingError, which the route maps to a translated message.
  const processed = await processUploadedImage(input.data);

  const scan = await fileScanner.scan(processed.data);
  if (!scan.clean) {
    log.warn({ ownerId: input.ownerId, threat: scan.threat }, "upload failed scan");
    throw new UploadRejectedError("INFECTED", scan.threat);
  }

  const keyVersion = activeKeyVersion();
  const envelope = encryptFile(processed.data, keyVersion);

  // Random UUID: never the client's filename, and not derived from anything
  // the client controls.
  const storageKey = randomUUID();
  const plaintextHash = sha256(processed.data.toString("base64"));

  await storage.put(storageKey, envelope);

  try {
    const record = await prisma.uploadedFile.create({
      data: {
        ownerId: input.ownerId,
        kind: input.kind,
        storageKey,
        mimeType: processed.mimeType,
        sizeBytes: processed.data.length,
        sha256: plaintextHash,
        encrypted: true,
        keyVersion,
        status: "UNATTACHED",
        scannedAt: new Date(),
      },
      select: { id: true, kind: true, mimeType: true, sizeBytes: true, createdAt: true },
    });

    await audit({
      actorId: input.ownerId,
      action: "file.uploaded",
      entityType: "UploadedFile",
      entityId: record.id,
      metadata: { kind: input.kind, bytes: record.sizeBytes },
      ip: input.ip,
    });

    log.info({ fileId: record.id, kind: input.kind }, "file uploaded");

    return { ...record, width: processed.width, height: processed.height };
  } catch (error) {
    // The row failed but the bytes are already written. Remove them rather
    // than leaving an object nothing points at.
    await storage.delete(storageKey).catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface FileRecord {
  id: string;
  ownerId: string | null;
  kind: FileKind;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  sha256: string;
  deletedAt: Date | null;
}

/** Metadata only - no bytes are read from storage. */
export async function getFileRecord(id: string): Promise<FileRecord | null> {
  const record = await prisma.uploadedFile.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      kind: true,
      mimeType: true,
      sizeBytes: true,
      storageKey: true,
      sha256: true,
      deletedAt: true,
    },
  });

  if (!record || record.deletedAt !== null) return null;
  return record;
}

export interface ReadFileOptions {
  /** Written to AuditLog before any bytes are returned. */
  audit?: {
    actorId: string;
    ip?: string | null;
  };
}

/**
 * Decrypts and returns a file's contents.
 *
 * When `audit` is supplied the entry is written with auditStrict() FIRST - if
 * it fails, this throws and the caller must not serve the file. That is the
 * rule for ID documents: an unrecorded view is worse than a denied one.
 */
export async function readFile(
  record: FileRecord,
  options: ReadFileOptions = {},
): Promise<Buffer> {
  if (options.audit) {
    await auditStrict({
      actorId: options.audit.actorId,
      action: "file.viewed",
      entityType: "UploadedFile",
      entityId: record.id,
      metadata: { kind: record.kind, ownerId: record.ownerId },
      ip: options.audit.ip,
    });
  }

  let envelope: Buffer;
  try {
    envelope = await storage.get(record.storageKey);
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      log.error({ fileId: record.id }, "storage object missing for existing row");
      throw new FileNotFoundError();
    }
    throw error;
  }

  const plaintext = decryptFile(envelope);

  // The stored hash is of the plaintext, so a mismatch means the ciphertext
  // decrypted cleanly but is not the file we recorded.
  if (sha256(plaintext.toString("base64")) !== record.sha256) {
    log.error({ fileId: record.id }, "sha256 mismatch after decryption");
    throw new Error("File integrity check failed");
  }

  return plaintext;
}

// ---------------------------------------------------------------------------
// Attach / delete / cleanup
// ---------------------------------------------------------------------------

/**
 * Marks files as belonging to a real record, so the orphan cleanup leaves
 * them alone. Called by the forms in phases 3 and 4.
 */
export async function attachFiles(
  fileIds: string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  if (fileIds.length === 0) return 0;

  const result = await tx.uploadedFile.updateMany({
    where: { id: { in: fileIds }, status: "UNATTACHED", deletedAt: null },
    data: { status: "ATTACHED", attachedAt: new Date() },
  });

  return result.count;
}

export interface DeleteFileOptions {
  actorId?: string | null;
  ip?: string | null;
  reason?: string;
}

/**
 * Destroys the stored bytes and marks the row deleted.
 *
 * The row survives on purpose: the AuditLog references it, and "this file
 * existed and was deleted on this date" is exactly what a retention policy
 * needs to be able to prove.
 */
export async function deleteFile(
  id: string,
  options: DeleteFileOptions = {},
): Promise<boolean> {
  const record = await prisma.uploadedFile.findUnique({
    where: { id },
    select: { id: true, storageKey: true, kind: true, deletedAt: true },
  });

  if (!record || record.deletedAt !== null) return false;

  // Bytes first. If this fails we have not yet claimed the file is gone.
  await storage.delete(record.storageKey);

  await prisma.uploadedFile.update({
    where: { id },
    data: { deletedAt: new Date(), status: "DELETED" },
  });

  await audit({
    actorId: options.actorId ?? null,
    action: "file.deleted",
    entityType: "UploadedFile",
    entityId: id,
    metadata: { kind: record.kind, reason: options.reason ?? "manual" },
    ip: options.ip,
  });

  log.info({ fileId: id }, "file deleted");
  return true;
}

export interface CleanupResult {
  examined: number;
  deleted: number;
  failed: number;
}

/**
 * Deletes uploads that were never linked to anything.
 *
 * Someone who starts an application, uploads their ID and then abandons the
 * form leaves a national ID scan on our disk attached to nothing. This is
 * what removes it. Phase 6 will schedule it; for now it is callable by hand
 * (scripts/cleanup-orphan-files.ts).
 */
export async function cleanupOrphanFiles(
  olderThanHours: number = env.ORPHAN_FILE_TTL_HOURS,
): Promise<CleanupResult> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const orphans = await prisma.uploadedFile.findMany({
    where: { status: "UNATTACHED", deletedAt: null, createdAt: { lt: cutoff } },
    select: { id: true },
    take: 500,
  });

  let deleted = 0;
  let failed = 0;

  for (const orphan of orphans) {
    try {
      const wasDeleted = await deleteFile(orphan.id, { reason: "orphan_cleanup" });
      if (wasDeleted) deleted++;
    } catch (error) {
      failed++;
      log.error({ fileId: orphan.id, err: error }, "orphan cleanup failed for file");
    }
  }

  if (deleted > 0) {
    await audit({
      action: "file.cleanup.orphan",
      entityType: "UploadedFile",
      metadata: { deleted, failed, olderThanHours },
    });
  }

  log.info({ examined: orphans.length, deleted, failed }, "orphan cleanup finished");
  return { examined: orphans.length, deleted, failed };
}
