import "server-only";

import { headers } from "next/headers";

/**
 * Client IP and user agent for rate limiting and session records.
 *
 * Behind nginx on the VPS the real address arrives in X-Forwarded-For; the
 * first entry is the client, the rest are proxies. The raw value is never
 * stored - callers hash it with hashIp() first.
 */
export async function getRequestContext(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  const headerList = await headers();

  const forwardedFor = headerList.get("x-forwarded-for");
  const ip =
    forwardedFor?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip") ||
    null;

  return { ip, userAgent: headerList.get("user-agent") };
}
