/**
 * Development SMS driver: prints the message to the server console.
 *
 * This is how OTP login is testable before a Syrian SMS gateway exists.
 */
import "server-only";

import { isProduction } from "../env";
import { maskPhone } from "../phone";
import type { SmsMessage, SmsProvider } from "./types";

export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";

  async send(message: SmsMessage): Promise<void> {
    // Hard stop rather than a warning. If this driver were ever selected in
    // production, every login would silently succeed at sending and no user
    // would receive anything - while OTP codes were written to the logs.
    if (isProduction) {
      throw new Error(
        "ConsoleSmsProvider must never run in production: it would print OTP codes to the logs.",
      );
    }

    // Written with console.log on purpose, bypassing src/lib/logger.ts, whose
    // redaction would strip exactly the code we are trying to read here.
    // Safe precisely because this path cannot execute in production.
    console.log(
      [
        "",
        "  ┌─────────────────────────────────────────────",
        "  │  SMS (development only)",
        `  │  to:   ${maskPhone(message.to)}`,
        `  │  body: ${message.body}`,
        "  └─────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  }
}
