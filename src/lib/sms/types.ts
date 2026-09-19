/**
 * SMS delivery contract.
 *
 * Reliable SMS delivery into Syria is an unsolved dependency: the usual
 * international gateways do not deliver there, and a local aggregator needs a
 * company contract. Rather than let that block the whole build, everything
 * goes through this interface and we ship on the console driver until a real
 * gateway is connected.
 */

export interface SmsMessage {
  /** E.164 destination, as produced by normalizeSyrianPhone(). */
  to: string;
  body: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<void>;
}

/** Thrown when no real gateway is wired up yet. */
export class SmsNotConfiguredError extends Error {
  constructor(providerName: string) {
    super(
      `SMS provider "${providerName}" is not configured. ` +
        `Connect a real gateway or set SMS_PROVIDER=console in development.`,
    );
    this.name = "SmsNotConfiguredError";
  }
}
