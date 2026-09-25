/**
 * Development email driver: prints the message to the server console, the
 * same way the SMS console driver does.
 */
import "server-only";

import { isProduction } from "../env";
import { maskEmail } from "../email-address";
import type { EmailMessage, EmailProvider } from "./types";

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(message: EmailMessage): Promise<void> {
    // Hard stop: in production this would silently "send" nothing while
    // writing sign-in codes into the logs.
    if (isProduction) {
      throw new Error("ConsoleEmailProvider must never run in production: it would print codes to the logs.");
    }
    // console.log on purpose (see src/lib/sms/console.ts): safe only because
    // this path cannot run in production.
    console.log(
      [
        "",
        "  ┌─────────────────────────────────────────────",
        "  │  EMAIL (development only)",
        `  │  to:      ${maskEmail(message.to)}`,
        `  │  subject: ${message.subject}`,
        `  │  body:    ${message.text}`,
        "  └─────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  }
}
