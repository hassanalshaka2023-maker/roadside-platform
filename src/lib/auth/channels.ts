/**
 * Which sign-in channels are open right now.
 *
 * Phone codes need a real SMS gateway in production (SMS_PROVIDER=stub means
 * there is none); email codes need EMAIL_PROVIDER. Until an SMS gateway is
 * connected, production runs on email alone.
 */
import "server-only";

import { env } from "../env";

export interface LoginChannels {
  phone: boolean;
  email: boolean;
}

export function loginChannels(): LoginChannels {
  return {
    phone: env.SMS_PROVIDER !== "stub",
    email: env.EMAIL_PROVIDER !== "disabled",
  };
}
