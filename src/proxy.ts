import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

import { routing } from "./i18n/routing";

/**
 * ============================================================================
 * THIS PROXY IS NOT A SECURITY BOUNDARY.
 *
 * It does two things: locale routing, and setting the Content-Security-Policy
 * (which needs a fresh nonce per request). It deliberately performs NO
 * authorization: it cannot reach the database, so it cannot know whether a
 * session is still valid or whether a user has been suspended.
 *
 * Every protected page, server action and route handler calls its own guard
 * from src/lib/auth/current-user.ts. See the comment at the top of that file.
 * ============================================================================
 */

const intlMiddleware = createMiddleware(routing);

const isProduction = process.env.NODE_ENV === "production";

function buildCsp(nonce: string): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    // 'strict-dynamic' lets the nonced Next.js bootstrap script load the rest
    // of the chunks, so we never need to allowlist hashes for every build.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // React Fast Refresh compiles modules with eval in development only.
      ...(isProduction ? [] : ["'unsafe-eval'"]),
    ],

    // LOOSENED: 'unsafe-inline' for styles.
    // next/font injects an inline <style> block, and Leaflet (phase 3) sets
    // inline styles on every map pane. Nonces do not apply to style
    // attributes, so removing this would mean giving up on either. Style
    // injection is a far weaker vector than script injection, and script-src
    // stays strict.
    "style-src": ["'self'", "'unsafe-inline'"],

    "img-src": [
      "'self'",
      "data:",
      "blob:",
      // OpenStreetMap raster tiles (phase 3). Listed now so the policy does
      // not have to be relaxed in a hurry when the map lands.
      "https://*.tile.openstreetmap.org",
      "https://*.basemaps.cartocdn.com",
    ],

    // Fonts are self-hosted by next/font at build time; no external origin.
    "font-src": ["'self'", "data:"],

    "connect-src": [
      "'self'",
      ...(isProduction ? [] : ["ws:", "wss:"]), // dev HMR socket
    ],

    // No plugins, no framing, no <base> hijacking, forms only to ourselves.
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
  };

  const policy = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");

  // Upgrade mixed content in production only; on http://localhost it would
  // rewrite every asset request to https and break local development.
  return isProduction ? `${policy}; upgrade-insecure-requests` : policy;
}

export default function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // Next.js reads the nonce back out of the request's CSP header and applies
  // it to the scripts it injects, so both headers have to travel inward.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = intlMiddleware(
    new NextRequest(request, { headers: requestHeaders }),
  );

  response.headers.set("content-security-policy", csp);
  response.headers.set("x-nonce", nonce);

  return response;
}

export const config = {
  /**
   * Run on everything except Next internals, static files and the API routes
   * that serve private files (those set their own headers and must not be
   * locale-rewritten).
   */
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};

export { NextResponse };
