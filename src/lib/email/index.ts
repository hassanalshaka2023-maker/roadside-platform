import "server-only";

import { env } from "../env";
import { ConsoleEmailProvider } from "./console";
import { SmtpEmailProvider } from "./smtp";
import type { EmailProvider } from "./types";

export * from "./types";

/** Null when email sign-in is switched off (EMAIL_PROVIDER=disabled). */
export const emailProvider: EmailProvider | null =
  env.EMAIL_PROVIDER === "smtp"
    ? new SmtpEmailProvider()
    : env.EMAIL_PROVIDER === "console"
      ? new ConsoleEmailProvider()
      : null;
