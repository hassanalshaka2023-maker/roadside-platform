import "server-only";

import { cache } from "react";

import { prisma } from "@/lib/db";
import { loggerFor } from "@/lib/logger";

const log = loggerFor("settings");

/**
 * Reads a runtime setting, falling back to a default.
 *
 * Never throws: the public pages read business phone numbers from here, and a
 * database hiccup should degrade the WhatsApp button, not the home page.
 *
 * Cached per request so a layout and a page can both ask without two queries.
 */
export const getSetting = cache(async function getSetting<T>(
  key: string,
  fallback: T,
): Promise<T> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    if (!row) return fallback;
    return row.value as T;
  } catch (error) {
    log.error({ err: error, key }, "failed to read setting");
    return fallback;
  }
});

/** Business contact numbers shown on the public site. */
export function getBusinessPhones(): Promise<string[]> {
  return getSetting<string[]>("businessPhones", []);
}
