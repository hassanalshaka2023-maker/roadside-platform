/**
 * Prints fresh random secrets for a new environment (e.g. Vercel).
 * Paste them into the hosting dashboard, never into a committed file.
 *
 *   node scripts/generate-secrets.mjs
 */
import { randomBytes } from "node:crypto";

const secret = () => randomBytes(32).toString("base64url");

console.log(`SESSION_SECRET=${secret()}`);
console.log(`OTP_HMAC_SECRET=${secret()}`);
console.log(`ID_HASH_SECRET=${secret()}`);
console.log(`FILE_ENCRYPTION_KEYS=1:${secret()}`);
console.log("FILE_ENCRYPTION_ACTIVE_VERSION=1");
console.log(`CRON_SECRET=${secret()}`);
console.log("\n# Keep FILE_ENCRYPTION_KEYS safe: losing it makes every stored file unreadable.");
