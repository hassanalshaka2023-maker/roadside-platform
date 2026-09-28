/**
 * Writes .env.production.local: everything the live site needs, ready to paste
 * into Vercel (Settings > Environment Variables accepts a whole .env block).
 *
 *   node scripts/prepare-production-env.mjs https://your-site.vercel.app
 *
 * - generates NEW secrets and admin passwords (never reuse development ones)
 * - copies S3_* and SMTP_* from your local .env
 * - the file is git-ignored (.env.*); keep it private and keep a copy of the
 *   admin passwords and FILE_ENCRYPTION_KEYS somewhere safe
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const OUT = ".env.production.local";
const appUrl = process.argv[2] ?? "https://roadside-platform.vercel.app";
const local = parseEnv(readFileSync(".env", "utf8"));
const secret = () => randomBytes(32).toString("base64url");
const password = () => randomBytes(18).toString("base64url");

if (existsSync(OUT) && !process.argv.includes("--force")) {
  console.error(`${OUT} already exists. Re-run with --force to replace it (the old secrets would stop working).`);
  process.exit(1);
}

const pick = (key, fallback = "") => local[key] ?? fallback;
const missing = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "SMTP_USER"].filter((k) => !local[k]);
const smtpPassMissing = !local.SMTP_PASS;

const lines = [
  "# Production settings - PRIVATE. Paste into Vercel > Settings > Environment Variables.",
  "# DATABASE_URL is added by the Neon integration; add it here only to run the seed.",
  "NODE_ENV=production",
  `APP_URL=${appUrl}`,
  "",
  `SESSION_SECRET=${secret()}`,
  `OTP_HMAC_SECRET=${secret()}`,
  `ID_HASH_SECRET=${secret()}`,
  `FILE_ENCRYPTION_KEYS=1:${secret()}`,
  "FILE_ENCRYPTION_ACTIVE_VERSION=1",
  `CRON_SECRET=${secret()}`,
  "",
  "RATE_LIMIT_DRIVER=postgres",
  "SMS_PROVIDER=stub",
  "EMAIL_PROVIDER=smtp",
  `SMTP_HOST=${pick("SMTP_HOST", "smtp.gmail.com")}`,
  `SMTP_PORT=${pick("SMTP_PORT", "465")}`,
  `SMTP_SECURE=${pick("SMTP_SECURE", "true")}`,
  `SMTP_USER=${pick("SMTP_USER")}`,
  `SMTP_PASS=${pick("SMTP_PASS")}`,
  `EMAIL_FROM=${pick("EMAIL_FROM")}`,
  "",
  "STORAGE_DRIVER=s3",
  `S3_ENDPOINT=${pick("S3_ENDPOINT")}`,
  `S3_REGION=${pick("S3_REGION", "eu-central-1")}`,
  `S3_BUCKET=${pick("S3_BUCKET", "uploads")}`,
  `S3_ACCESS_KEY_ID=${pick("S3_ACCESS_KEY_ID")}`,
  `S3_SECRET_ACCESS_KEY=${pick("S3_SECRET_ACCESS_KEY")}`,
  `S3_FORCE_PATH_STYLE=${pick("S3_FORCE_PATH_STYLE", "true")}`,
  "UPLOAD_MAX_BYTES=4194304",
  "",
  `SEED_ADMIN_EMAIL=${pick("SEED_ADMIN_EMAIL", "admin@najdat24.sy")}`,
  `SEED_ADMIN_PASSWORD=${password()}`,
  `SEED_DISPATCHER_EMAIL=${pick("SEED_DISPATCHER_EMAIL", "dispatcher@najdat24.sy")}`,
  `SEED_DISPATCHER_PASSWORD=${password()}`,
  "LOG_LEVEL=info",
];

writeFileSync(OUT, lines.join("\n") + "\n", { mode: 0o600 });
console.log(`Wrote ${OUT}`);
if (missing.length) console.log(`MISSING in .env (fill them in ${OUT}): ${missing.join(", ")}`);
if (smtpPassMissing) console.log("SMTP_PASS is empty: add the Gmail App Password, or nobody can sign in on the live site.");
