/**
 * Audit trail.
 *
 * Append-only by convention: nothing in the codebase updates or deletes
 * AuditLog rows. Every sensitive action lands here - above all, each time an
 * ID document is viewed (phase 2).
 *
 * Writing an audit row must never break the action it is recording, so
 * failures are logged and swallowed.
 */
import "server-only";

import { hashIp } from "./crypto";
import { prisma } from "./db";
import { loggerFor } from "./logger";

const log = loggerFor("audit");

/**
 * Known audit actions. A union rather than free strings, so the audit screen
 * can render each one and nothing gets logged under three different spellings.
 */
export type AuditAction =
  | "auth.admin.login.success"
  | "auth.admin.login.failure"
  | "auth.admin.login.locked"
  | "auth.otp.requested"
  | "auth.otp.verified"
  | "auth.logout"
  | "auth.sessions.revoked"
  | "rbac.denied"
  | "user.created"
  | "user.status.changed"
  | "file.viewed"
  | "settings.updated";

export interface AuditEntry {
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: (entry.metadata ?? {}) as object,
        ipHash: hashIp(entry.ip),
      },
    });
  } catch (error) {
    // Never let an audit failure take down the request it is describing.
    log.error({ err: error, action: entry.action }, "failed to write audit log");
  }
}
