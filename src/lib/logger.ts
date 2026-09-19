/**
 * Structured logging.
 *
 * The security rules forbid logging OTP codes, full phone numbers, tokens and
 * document contents. Relying on everyone remembering that does not work, so
 * the redaction is built into the logger itself: even if someone passes a
 * whole request body, the sensitive keys come out as [redacted].
 *
 * When you genuinely need a phone number in a log line, pass it through
 * `maskPhone()` from src/lib/phone.ts and log it as `phoneMasked`.
 */
import "server-only";

import pino from "pino";

import { env, isProduction } from "./env";

/**
 * Keys that must never reach a log sink, at the top level or one/two levels
 * deep (request bodies and form payloads are usually nested that far).
 */
const SENSITIVE_KEYS = [
  "phone",
  "phoneNumber",
  "otp",
  "otpCode",
  "code",
  "codeHash",
  "password",
  "passwordHash",
  "newPassword",
  "currentPassword",
  "token",
  "tokenHash",
  "sessionToken",
  "secret",
  "authorization",
  "cookie",
  "idNumber",
  "idHash",
  "plateNumber",
  "storageKey",
];

const redactPaths = SENSITIVE_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
]);

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      ...redactPaths,
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
    ],
    censor: "[redacted]",
  },
  // Pretty output in development only. In production we emit newline-delimited
  // JSON to stdout and let the container runtime collect it.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
});

/** A child logger tagged with the module it came from. */
export function loggerFor(module: string) {
  return logger.child({ module });
}
