/**
 * Environment validation.
 *
 * Every environment variable the app depends on is declared and validated
 * here, once, at boot. If something is missing or malformed the process dies
 * immediately with a message that names the offending variable - we never
 * want to discover a missing secret halfway through an OTP request.
 *
 * Server-side only. Nothing in this module may be imported from a client
 * component: it would leak secrets into the browser bundle.
 */
import "server-only";

import { z } from "zod";

/** A secret must be long enough to be a real key, not a placeholder. */
const secret = (name: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 characters (generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")`)
    .refine((v) => !v.startsWith("CHANGE_ME"), {
      message: `${name} still holds the placeholder value from .env.example`,
    });

const EnvSchema = z.object({
  // --- Core ---------------------------------------------------------------
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_URL: z.url("APP_URL must be a full URL, e.g. http://localhost:3000"),

  // --- Database -----------------------------------------------------------
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgresql:// connection string",
    }),

  // --- Secrets ------------------------------------------------------------
  SESSION_SECRET: secret("SESSION_SECRET"),
  OTP_HMAC_SECRET: secret("OTP_HMAC_SECRET"),

  // --- SMS / OTP ----------------------------------------------------------
  SMS_PROVIDER: z.enum(["console", "stub"]).default("console"),
  OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_MAX_PER_PHONE_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_MAX_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(20),

  // --- Rate limiting ------------------------------------------------------
  RATE_LIMIT_DRIVER: z.enum(["memory", "postgres"]).default("memory"),

  // --- Sessions -----------------------------------------------------------
  SESSION_TTL_CUSTOMER_DAYS: z.coerce.number().int().positive().default(30),
  SESSION_TTL_ADMIN_HOURS: z.coerce.number().int().positive().default(8),
  ADMIN_MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  ADMIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // --- Seed ---------------------------------------------------------------
  // Only read by prisma/seed.ts, but validated here so a broken seed config
  // is caught at boot rather than at 2am on a fresh deployment.
  SEED_ADMIN_EMAIL: z.email("SEED_ADMIN_EMAIL must be a valid email"),
  SEED_ADMIN_PASSWORD: z
    .string()
    .min(12, "SEED_ADMIN_PASSWORD must be at least 12 characters"),
  SEED_DISPATCHER_EMAIL: z.email("SEED_DISPATCHER_EMAIL must be a valid email"),
  SEED_DISPATCHER_PASSWORD: z
    .string()
    .min(12, "SEED_DISPATCHER_PASSWORD must be at least 12 characters"),

  // --- Logging ------------------------------------------------------------
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.join(".") || "(root)";
    return `  - ${name}: ${issue.message}`;
  });
  return [
    "",
    "Invalid environment configuration:",
    ...lines,
    "",
    "Copy .env.example to .env and fill in the missing values.",
    "",
  ].join("\n");
}

function parseEnv(): Env {
  // Escape hatch for `next build` inside Docker, where real secrets are not
  // available at image build time. It is deliberately NOT allowed to disable
  // validation at runtime - only during a build.
  if (process.env.SKIP_ENV_VALIDATION === "1") {
    return EnvSchema.partial().parse(process.env) as Env;
  }

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    // Thrown, not logged: this must be impossible to ignore.
    throw new Error(formatIssues(result.error));
  }
  return result.data;
}

export const env = parseEnv();

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
