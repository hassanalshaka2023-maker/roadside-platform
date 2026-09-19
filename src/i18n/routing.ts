import { defineRouting } from "next-intl/routing";

/**
 * Arabic is the default and the product's primary language; English is
 * secondary and mostly there for non-Arabic speakers living in Syria.
 *
 * `localePrefix: "always"` means every URL carries its locale (/ar/..., /en/...).
 * That costs three characters in the URL and buys unambiguous routing, simple
 * cache keys, and language switching that is a plain link rather than a
 * cookie negotiation.
 */
export const routing = defineRouting({
  locales: ["ar", "en"],
  defaultLocale: "ar",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

/** Text direction for a locale. Arabic is RTL; English is LTR. */
export function directionOf(locale: string): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
