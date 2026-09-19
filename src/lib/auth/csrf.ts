/**
 * CSRF protection.
 *
 * Sessions use SameSite=Lax cookies, which already blocks cross-site POSTs
 * from a plain form. On top of that, every mutating request must come from
 * our own origin. Next.js server actions do their own origin check, but route
 * handlers do not, and we do not want the app's safety to depend on a
 * framework internal we did not write.
 */
import "server-only";

import { headers } from "next/headers";

import { env } from "../env";
import { loggerFor } from "../logger";

const log = loggerFor("auth/csrf");

/** Methods that can change state and therefore need the check. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class CsrfError extends Error {
  constructor(detail: string) {
    super(`CSRF check failed: ${detail}`);
    this.name = "CsrfError";
  }
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * Verifies that the request originates from this app.
 *
 * Compares the Origin header against both the Host header and the configured
 * APP_URL. A missing Origin is rejected for mutating requests: every browser
 * we support sends it on POST, so its absence means a non-browser client that
 * has no business replaying a session cookie.
 */
export async function assertSameOrigin(method = "POST"): Promise<void> {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return;

  const headerList = await headers();
  const origin = headerList.get("origin");
  const host = headerList.get("host");

  const originHost = hostOf(origin);
  const appHost = hostOf(env.APP_URL);

  if (!originHost) {
    log.warn({ host }, "rejected request with no Origin header");
    throw new CsrfError("missing Origin header");
  }

  const matchesHost = host !== null && originHost === host;
  const matchesAppUrl = appHost !== null && originHost === appHost;

  if (!matchesHost && !matchesAppUrl) {
    log.warn({ originHost, host }, "rejected cross-origin request");
    throw new CsrfError(`origin ${originHost} does not match ${host ?? appHost}`);
  }
}

/** Non-throwing variant, for middleware. */
export function isSameOrigin(
  origin: string | null,
  host: string | null,
  appUrl: string = env.APP_URL,
): boolean {
  const originHost = hostOf(origin);
  if (!originHost) return false;
  return originHost === host || originHost === hostOf(appUrl);
}
