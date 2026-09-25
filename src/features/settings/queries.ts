import "server-only";

import { cache } from "react";

import { readSetting } from "./platform";

/**
 * Business contact numbers shown on the public site. Never throws: a
 * database hiccup degrades the WhatsApp button, not the home page. Cached per
 * request so the header, footer and button share one query.
 */
export const getBusinessPhones = cache(async (): Promise<string[]> => {
  return readSetting("businessPhones");
});

export const isWhatsappEnabled = cache(async (): Promise<boolean> => {
  return readSetting("whatsappEnabled");
});
