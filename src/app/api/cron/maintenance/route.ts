/**
 * GET /api/cron/maintenance - scheduled housekeeping.
 *
 * Called by Vercel Cron (see vercel.json), which sends
 * "Authorization: Bearer $CRON_SECRET". Without CRON_SECRET configured the
 * route does not exist. Everything here is also safe to run by hand.
 *
 *   - closes expired searches (pages also do this lazily on load)
 *   - deletes uploads that were never attached to anything
 *   - prunes old OTP rows
 */
import { NextResponse } from "next/server";

import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { pruneExpiredOtpCodes } from "@/lib/auth/otp";
import { cleanupOrphanFiles } from "@/lib/files/service";
import { loggerFor } from "@/lib/logger";
import { sweepExpiredSearches } from "@/features/requests/service";

const log = loggerFor("api/cron");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const secret = env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return new NextResponse(null, { status: 404 });
  }

  const closedSearches = await sweepExpiredSearches();
  const files = await cleanupOrphanFiles();
  const otpRows = await pruneExpiredOtpCodes();

  log.info({ closedSearches, files, otpRows }, "maintenance done");
  return NextResponse.json({ ok: true, closedSearches, files, otpRows }, { headers: { "Cache-Control": "no-store" } });
}
