/**
 * Placeholder for the real Syrian SMS gateway.
 *
 * When a contract with a local aggregator (Syriatel / MTN reseller) is in
 * place, implement `send` here: build the request, post it, map the response,
 * and throw on a non-delivery so the caller can fall back.
 *
 * Whatever the gateway's API looks like, two rules hold:
 *   - never log the message body (it contains the OTP code)
 *   - never log the full destination number; use maskPhone()
 */
import "server-only";

import { loggerFor } from "../logger";
import { maskPhone } from "../phone";
import { SmsNotConfiguredError, type SmsMessage, type SmsProvider } from "./types";

const log = loggerFor("sms/stub");

export class StubSmsProvider implements SmsProvider {
  readonly name = "stub";

  async send(message: SmsMessage): Promise<void> {
    log.error(
      { phoneMasked: maskPhone(message.to) },
      "SMS send attempted with no gateway configured",
    );
    throw new SmsNotConfiguredError(this.name);
  }
}
