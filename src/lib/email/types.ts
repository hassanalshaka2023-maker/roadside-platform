/**
 * Email delivery contract. Used for sign-in codes while no SMS gateway is
 * connected, and switchable like the SMS drivers.
 */
export interface EmailMessage {
  /** Lowercased address, as produced by normalizeEmail(). */
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}
