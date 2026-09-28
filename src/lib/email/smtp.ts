/**
 * SMTP driver. Works with any provider that offers SMTP - including free
 * tiers such as Gmail (app password), Brevo or Zoho - so switching provider
 * is a change of environment variables only.
 *
 * Never logs the message body (it contains the code) or the full address.
 */
import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { env } from "../env";
import { maskEmail } from "../email-address";
import { loggerFor } from "../logger";
import { smtpHostOptions } from "./resolve-host";
import type { EmailMessage, EmailProvider } from "./types";

const log = loggerFor("email/smtp");

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private transporter: Transporter | null = null;

  private async transport(): Promise<Transporter> {
    this.transporter ??= nodemailer.createTransport({
      ...(await smtpHostOptions(env.SMTP_HOST!)),
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      // A slow mail server must not hold a sign-in open for minutes.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await (await this.transport()).sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (error) {
      log.error({ to: maskEmail(message.to), err: error }, "email send failed");
      throw error;
    }
  }
}
