import "server-only";

import { env } from "../env";
import { ConsoleSmsProvider } from "./console";
import { StubSmsProvider } from "./stub";
import type { SmsProvider } from "./types";

export * from "./types";
export { ConsoleSmsProvider } from "./console";
export { StubSmsProvider } from "./stub";

export const smsProvider: SmsProvider =
  env.SMS_PROVIDER === "stub" ? new StubSmsProvider() : new ConsoleSmsProvider();
