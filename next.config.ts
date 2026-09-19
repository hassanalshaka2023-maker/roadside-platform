import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isProduction = process.env.NODE_ENV === "production";

/**
 * Security headers that do not need a per-request value.
 * The Content-Security-Policy is set in src/proxy.ts instead, because it
 * carries a per-request nonce.
 */
const securityHeaders = [
  // Clickjacking. The app is never meant to be framed.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send the origin only cross-site, so a customer's tracking URL (which
  // contains their request code) never leaks in a Referer header.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Geolocation is needed by the map in phase 3, for this origin only.
    value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // Keeps the app out of cross-origin popups' reach.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProduction
    ? [
        // HSTS only in production: sending it over plain-HTTP localhost would
        // pin the browser to https for the whole machine's localhost.
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle for a small Docker image.
  output: "standalone",

  // Pin the workspace root. Without it, Turbopack walks up the directory tree,
  // finds an unrelated package-lock.json in the user's home folder and warns
  // about it on every build.
  turbopack: { root: import.meta.dirname },

  // These packages must stay as real Node modules rather than being bundled:
  // pino loads its transport in a worker thread, and @node-rs/argon2 is a
  // native addon.
  serverExternalPackages: ["pino", "pino-pretty", "@node-rs/argon2"],

  // Fail the production build on type errors rather than shipping them.
  // (Linting runs as its own step: `npm run lint`.)
  typescript: { ignoreBuildErrors: false },

  // Do not advertise the framework version to attackers.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
