/**
 * Test environment.
 *
 * src/lib/env.ts validates at import time and dies on anything missing, so
 * these have to be in place before any module under test is loaded. They are
 * obvious fakes: nothing here touches a real database, a real gateway or a
 * real storage bucket.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

// NODE_ENV is set to "test" by Vitest itself, and @types/node now declares it
// read-only, so it is deliberately not assigned here.
process.env.APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-000000";
process.env.OTP_HMAC_SECRET = "test-otp-hmac-secret-that-is-long-enough-0000";
process.env.SMS_PROVIDER = "console";
process.env.RATE_LIMIT_DRIVER = "memory";
process.env.SEED_ADMIN_EMAIL = "admin@example.test";
process.env.SEED_ADMIN_PASSWORD = "test-admin-password";
process.env.SEED_DISPATCHER_EMAIL = "dispatcher@example.test";
process.env.SEED_DISPATCHER_PASSWORD = "test-dispatcher-pass";
process.env.LOG_LEVEL = "fatal";

// --- phase 2: file storage -------------------------------------------------

/**
 * Two key versions, so rotation can actually be tested: a file encrypted
 * under version 1 must still decrypt after the active version moves to 2.
 * Fixed byte patterns rather than random, so a failure is reproducible.
 */
export const TEST_KEY_V1 = Buffer.alloc(32, 0x11).toString("base64url");
export const TEST_KEY_V2 = Buffer.alloc(32, 0x22).toString("base64url");
export const TEST_KEY_WRONG = Buffer.alloc(32, 0x33).toString("base64url");

process.env.FILE_ENCRYPTION_KEYS = `1:${TEST_KEY_V1},2:${TEST_KEY_V2}`;
process.env.FILE_ENCRYPTION_ACTIVE_VERSION = "1";
process.env.ID_HASH_SECRET = "test-id-hash-secret-that-is-long-enough-00000";

process.env.STORAGE_DRIVER = "local";
// Outside the project directory, which LocalDiskDriver insists on.
process.env.UPLOADS_DIR = join(tmpdir(), "roadside-test-uploads");

process.env.UPLOAD_MAX_BYTES = String(8 * 1024 * 1024);
process.env.UPLOAD_MAX_DIMENSION = "2000";
// Low enough that a modest test image can trip it.
process.env.UPLOAD_MAX_PIXELS = "25000000";
process.env.UPLOAD_MAX_FILES_PER_DAY = "20";
process.env.UPLOAD_MAX_BYTES_PER_DAY = String(64 * 1024 * 1024);
process.env.ORPHAN_FILE_TTL_HOURS = "24";
