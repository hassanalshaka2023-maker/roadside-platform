/**
 * GET /api/health - liveness plus a database round trip.
 *
 * Deliberately says nothing about versions, hosts or configuration: it is
 * reachable without a session. 200 when the database answers, 503 when not.
 */
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { loggerFor } from "@/lib/logger";

const log = loggerFor("api/health");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", database: "ok", latencyMs: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    log.error({ err: error }, "health check: database unreachable");
    return NextResponse.json(
      { status: "degraded", database: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
