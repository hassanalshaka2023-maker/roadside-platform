/**
 * GET    /api/files/[id]   - stream a private file
 * DELETE /api/files/[id]   - destroy the stored bytes
 *
 * This is the ONLY way to read an uploaded file. Nothing is served from
 * /public and no storage URL is ever handed to a browser.
 *
 * Denials are deliberately uniform: a missing file, a file belonging to
 * someone else and a file the viewer lacks the permission for all return the
 * same 403 with the same body. Distinguishing them would turn this endpoint
 * into an oracle for which file IDs exist.
 */
import { NextResponse } from "next/server";

import { audit, AuditWriteError } from "@/lib/audit";
import { assertSameOrigin, CsrfError } from "@/lib/auth/csrf";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { canViewFile, isIdDocument, type FileKindName } from "@/lib/files/access";
import {
  deleteFile,
  FileNotFoundError,
  getFileRecord,
  readFile,
} from "@/lib/files/service";
import { loggerFor } from "@/lib/logger";
import { consumeLimit } from "@/lib/rate-limit";
import { getRequestContext } from "@/lib/request-context";

const log = loggerFor("api/files/read");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(status: number, errorKey: string) {
  return NextResponse.json(
    { ok: false, errorKey },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** One response for every "no", so nothing leaks about what exists. */
const forbidden = () => jsonError(403, "errors.forbidden");
const unauthorized = () => jsonError(401, "errors.unauthorized");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  // Malformed IDs are refused the same way as anything else, so probing with
  // junk tells an attacker nothing either.
  if (!UUID.test(id)) return forbidden();

  const limit = await consumeLimit("fileReadPerUser", user.id);
  if (!limit.allowed) return jsonError(429, "files.errors.RATE_LIMITED");

  const record = await getFileRecord(id);
  if (!record) return forbidden();

  const context = await getRequestContext();

  const decision = canViewFile({
    viewer: user,
    ownerId: record.ownerId,
    kind: record.kind as FileKindName,
  });

  if (!decision.allowed) {
    log.warn(
      { fileId: id, userId: user.id, kind: record.kind, reason: decision.reason },
      "file access denied",
    );

    // Best-effort: a denial record must not itself be able to fail the response.
    await audit({
      actorId: user.id,
      action: "file.access.denied",
      entityType: "UploadedFile",
      entityId: id,
      metadata: { kind: record.kind, reason: decision.reason },
      ip: context.ip,
    });

    return decision.reason === "ANONYMOUS" ? unauthorized() : forbidden();
  }

  try {
    // For ID documents this writes the audit row FIRST and throws if it
    // cannot, so an unrecorded view is impossible.
    const data = await readFile(record, {
      audit: decision.mustAudit
        ? { actorId: user.id, ip: context.ip }
        : undefined,
    });

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        // Content type comes from OUR database, set when we re-encoded the
        // image - never from the request or the stored bytes.
        "Content-Type": record.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": "inline",
        // Private documents must not sit in a browser or proxy cache.
        "Cache-Control": "no-store, private, max-age=0",
        "X-Content-Type-Options": "nosniff",
        // Defence in depth if this URL is ever put in an <img> on a page with
        // a weaker policy.
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof AuditWriteError) {
      // The audit trail is the point. No record, no view.
      log.error({ fileId: id, userId: user.id }, "denying view: audit write failed");
      return jsonError(503, "files.errors.AUDIT_UNAVAILABLE");
    }

    if (error instanceof FileNotFoundError) return forbidden();

    log.error({ err: error, fileId: id }, "file read failed");
    return jsonError(500, "errors.genericTitle");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  try {
    await assertSameOrigin("DELETE");
  } catch (error) {
    if (error instanceof CsrfError) return jsonError(403, "errors.csrf");
    throw error;
  }

  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!UUID.test(id)) return forbidden();

  const record = await getFileRecord(id);
  if (!record) return forbidden();

  // The owner may remove their own upload before it is attached to anything -
  // that is the "remove" button in the upload widget. Otherwise only an admin
  // who can already see the file may delete it.
  const isOwner = record.ownerId !== null && record.ownerId === user.id;
  const isIdDoc = isIdDocument(record.kind as FileKindName);
  const allowed = isOwner || (isIdDoc ? can(user, "viewIdDocuments") : can(user, "viewAllRequests"));

  if (!allowed) return forbidden();

  const context = await getRequestContext();
  const deleted = await deleteFile(id, {
    actorId: user.id,
    ip: context.ip,
    reason: isOwner ? "owner_removed" : "admin_removed",
  });

  return NextResponse.json(
    { ok: deleted },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
