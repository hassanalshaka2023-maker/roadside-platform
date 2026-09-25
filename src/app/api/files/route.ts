/**
 * POST /api/files?kind=ID_FRONT
 *
 * Upload endpoint. The body is the RAW image bytes, not multipart.
 *
 * Why raw: the size limit has to be enforced while the body streams in.
 * `request.formData()` buffers the entire request into memory before handing
 * it over, so a multipart endpoint could only reject an oversized upload
 * after already holding it - which is the opposite of a limit. Reading
 * `request.body` as a stream lets us abort the moment the counter is exceeded.
 *
 * The trade-off is that uploads need JavaScript. Acceptable: the widget needs
 * it anyway for camera capture, preview and client-side compression.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { assertSameOrigin, CsrfError } from "@/lib/auth/csrf";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canUploadKind } from "@/lib/files/access";
import { ImageProcessingError } from "@/lib/files/image";
import { uploadFile, UploadRejectedError } from "@/lib/files/service";
import { env } from "@/lib/env";
import { loggerFor } from "@/lib/logger";
import { consumeLimit } from "@/lib/rate-limit";
import { getRequestContext } from "@/lib/request-context";

const log = loggerFor("api/files/upload");

// Uploads decode images with sharp, which is Node-only.
export const runtime = "nodejs";
// Never cached, never statically analysed for prerendering.
export const dynamic = "force-dynamic";

const kindSchema = z.enum([
  "ID_FRONT",
  "ID_BACK",
  "SELFIE",
  "REQUEST_PHOTO",
  "EQUIPMENT_PHOTO",
  "VEHICLE_PHOTO",
  "VEHICLE_DOCUMENT",
]);

/** Consistent JSON error shape. `errorKey` is a next-intl message key. */
function fail(status: number, errorKey: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, errorKey, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Reads the body with a hard byte ceiling.
 *
 * Content-Length is checked first as a cheap rejection, but it is a claim by
 * the client and can lie, so the running counter is the real enforcement.
 */
async function readBodyWithLimit(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Buffer | null> {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        // Stop pulling immediately; do not keep reading a body we will reject.
        await reader.cancel().catch(() => {});
        return null;
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

export async function POST(request: Request): Promise<Response> {
  // 1. CSRF -----------------------------------------------------------------
  try {
    await assertSameOrigin("POST");
  } catch (error) {
    if (error instanceof CsrfError) return fail(403, "errors.csrf");
    throw error;
  }

  // 2. Authentication -------------------------------------------------------
  const user = await getCurrentUser();
  if (!user) return fail(401, "errors.unauthorized");

  // 3. Input validation -----------------------------------------------------
  const url = new URL(request.url);
  const parsedKind = kindSchema.safeParse(url.searchParams.get("kind"));
  if (!parsedKind.success) return fail(400, "files.errors.INVALID_KIND");

  const kind = parsedKind.data;
  if (!canUploadKind(user, kind)) return fail(403, "errors.forbidden");

  // 4. Rate limiting --------------------------------------------------------
  const context = await getRequestContext();

  const perUser = await consumeLimit("uploadPerUser", user.id);
  if (!perUser.allowed) return fail(429, "files.errors.RATE_LIMITED");

  if (context.ip) {
    const perIp = await consumeLimit("uploadPerIp", context.ip);
    if (!perIp.allowed) return fail(429, "files.errors.RATE_LIMITED");
  }

  // 5. Body -----------------------------------------------------------------
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > env.UPLOAD_MAX_BYTES) {
    return fail(413, "files.errors.TOO_LARGE");
  }

  if (!request.body) return fail(400, "files.errors.EMPTY");

  const data = await readBodyWithLimit(request.body, env.UPLOAD_MAX_BYTES);
  if (data === null) return fail(413, "files.errors.TOO_LARGE");
  if (data.length === 0) return fail(400, "files.errors.EMPTY");

  // 6. Process and store ----------------------------------------------------
  try {
    const file = await uploadFile({
      ownerId: user.id,
      kind,
      data,
      ip: context.ip,
    });

    return NextResponse.json(
      { ok: true, file },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      return fail(400, `files.errors.${error.code}`);
    }

    if (error instanceof UploadRejectedError) {
      const status = error.code.startsWith("QUOTA") ? 429 : 400;
      return fail(status, `files.errors.${error.code}`);
    }

    // Never echo the underlying message to the client.
    log.error({ err: error, userId: user.id }, "upload failed");
    await audit({
      actorId: user.id,
      action: "file.uploaded",
      entityType: "UploadedFile",
      metadata: { kind, outcome: "error" },
      ip: context.ip,
    });

    return fail(500, "errors.genericTitle");
  }
}
