/**
 * Test environment.
 *
 * src/lib/env.ts validates at import time and dies on anything missing, so
 * these have to be in place before any module under test is loaded. They are
 * obvious fakes: nothing here touches a real database or a real gateway.
 */
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
