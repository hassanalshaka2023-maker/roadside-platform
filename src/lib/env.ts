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

/**
 * Parses a versioned key ring: "1:<base64url>,2:<base64url>".
 *
 * Returns a Map<version, 32-byte key>. Old versions are kept deliberately:
 * rotating the active key must not make previously encrypted files
 * unreadable, so every key that ever encrypted a file stays here.
 */
const keyRing = (name: string) =>
  z
    .string()
    .min(1, `${name} is required`)
    .transform((raw, ctx) => {
      const keys = new Map<number, Buffer>();

      for (const entry of raw.split(",")) {
        const trimmed = entry.trim();
        if (!trimmed) continue;

        const separator = trimmed.indexOf(":");
        if (separator === -1) {
          ctx.addIssue({
            code: "custom",
            message: `${name} entry "${trimmed.slice(0, 12)}…" is not in the form <version>:<base64url key>`,
          });
          return z.NEVER;
        }

        const version = Number(trimmed.slice(0, separator));
        const material = trimmed.slice(separator + 1);

        if (!Number.isInteger(version) || version < 1 || version > 255) {
          ctx.addIssue({
            code: "custom",
            message: `${name} has an invalid version "${trimmed.slice(0, separator)}" (must be 1-255; it is stored in a single byte of the file header)`,
          });
          return z.NEVER;
        }

        const key = Buffer.from(material, "base64url");
        if (key.length !== 32) {
          ctx.addIssue({
            code: "custom",
            message: `${name} version ${version} decodes to ${key.length} bytes; AES-256 needs exactly 32 (generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")`,
          });
          return z.NEVER;
        }

        if (keys.has(version)) {
          ctx.addIssue({
            code: "custom",
            message: `${name} declares version ${version} twice`,
          });
          return z.NEVER;
        }

        keys.set(version, key);
      }

      if (keys.size === 0) {
        ctx.addIssue({ code: "custom", message: `${name} contains no usable keys` });
        return z.NEVER;
      }

      return keys;
    });

const EnvSchemaBase = z.object({
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

  // --- File storage (phase 2) ---------------------------------------------
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),

  /**
   * Absolute path for the local driver. MUST be outside the project directory
   * and must never be under public/ - the driver refuses to start otherwise.
   */
  UPLOADS_DIR: z.string().optional(),

  // S3-compatible storage. Only read when STORAGE_DRIVER=s3.
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** MinIO and most non-AWS providers need path-style addressing. */
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  // --- File encryption ----------------------------------------------------
  /**
   * Versioned AES-256 keys: "1:<base64url>,2:<base64url>".
   * Old versions must be KEPT so existing files stay readable after a
   * rotation; only the active version is used for new files.
   */
  FILE_ENCRYPTION_KEYS: keyRing("FILE_ENCRYPTION_KEYS"),
  FILE_ENCRYPTION_ACTIVE_VERSION: z.coerce.number().int().positive().default(1),

  /** HMAC key for hashing national ID numbers (duplicate detection only). */
  ID_HASH_SECRET: secret("ID_HASH_SECRET"),

  // --- Upload limits ------------------------------------------------------
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  /** Longest side of the stored image, in pixels. */
  UPLOAD_MAX_DIMENSION: z.coerce.number().int().positive().default(2000),
  /** Decompression-bomb guard: refuse to decode beyond this many pixels. */
  UPLOAD_MAX_PIXELS: z.coerce.number().int().positive().default(50_000_000),
  UPLOAD_MAX_FILES_PER_DAY: z.coerce.number().int().positive().default(20),
  UPLOAD_MAX_BYTES_PER_DAY: z.coerce
    .number()
    .int()
    .positive()
    .default(64 * 1024 * 1024),
  /** How long an unattached file survives before the cleanup job removes it. */
  ORPHAN_FILE_TTL_HOURS: z.coerce.number().int().positive().default(24),

  // --- Maps (phase 3) -----------------------------------------------------
  /**
   * Raster tile template for Leaflet.
   *
   * Read on the server and passed down as a prop, NOT exposed as
   * NEXT_PUBLIC_*, so it stays inside this validated schema.
   *
   * The default is the public OpenStreetMap server, which is fine for
   * development but whose usage policy forbids production traffic. Point this
   * at a keyed provider or a self-hosted tile server before launch.
   */
  MAP_TILE_URL: z
    .string()
    .default("https://tile.openstreetmap.org/{z}/{x}/{y}.png")
    .refine((value) => value.includes("{z}") && value.includes("{x}") && value.includes("{y}"), {
      message: "MAP_TILE_URL must contain the {z}, {x} and {y} placeholders",
    }),
  /** Attribution text. Required by the OSM licence, and by most providers. */
  MAP_TILE_ATTRIBUTION: z
    .string()
    .default('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'),

  /** Where the map opens before the customer's location is known. Damascus. */
  MAP_DEFAULT_LAT: z.coerce.number().default(33.5138),
  MAP_DEFAULT_LNG: z.coerce.number().default(36.2765),
  MAP_DEFAULT_ZOOM: z.coerce.number().int().min(1).max(19).default(13),
});

/**
 * Cross-field rules. Kept separate from the object schema so the
 * SKIP_ENV_VALIDATION path below can still call `.partial()` on the base.
 */
const EnvSchema = EnvSchemaBase.superRefine((value, ctx) => {
  if (value.STORAGE_DRIVER === "local" && !value.UPLOADS_DIR) {
    ctx.addIssue({
      code: "custom",
      path: ["UPLOADS_DIR"],
      message: "UPLOADS_DIR is required when STORAGE_DRIVER=local",
    });
  }

  if (value.STORAGE_DRIVER === "s3") {
    for (const key of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when STORAGE_DRIVER=s3`,
        });
      }
    }
  }

  // A rotation that drops the active version would make every new upload fail
  // at write time instead of here, at boot.
  if (!value.FILE_ENCRYPTION_KEYS.has(value.FILE_ENCRYPTION_ACTIVE_VERSION)) {
    ctx.addIssue({
      code: "custom",
      path: ["FILE_ENCRYPTION_ACTIVE_VERSION"],
      message:
        `FILE_ENCRYPTION_ACTIVE_VERSION=${value.FILE_ENCRYPTION_ACTIVE_VERSION} ` +
        `has no matching key in FILE_ENCRYPTION_KEYS ` +
        `(present: ${[...value.FILE_ENCRYPTION_KEYS.keys()].join(", ") || "none"})`,
    });
  }
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
    return EnvSchemaBase.partial().parse(process.env) as Env;
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
