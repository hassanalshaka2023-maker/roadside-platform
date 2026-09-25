/**
 * Sends one test email through the configured SMTP account, to check the
 * settings before relying on them for sign-in codes:
 *
 *   npm run email:test -- you@example.com
 */
import nodemailer from "nodemailer";

try {
  process.loadEnvFile();
} catch {
  // Environment already populated.
}

async function main() {
  const to = process.argv[2];
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
  if (!to || !to.includes("@")) throw new Error("Usage: npm run email:test -- you@example.com");
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) {
    throw new Error("Set SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM in .env first");
  }

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transport.verify();
  await transport.sendMail({
    from: EMAIL_FROM,
    to,
    subject: "نجدة الطريق 24 - رسالة تجريبية",
    text: "إذا وصلتك هذه الرسالة فإعدادات البريد صحيحة.",
  });
  console.log("Sent. Check the inbox (and the spam folder) of", to);
}

main().catch((error) => {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
