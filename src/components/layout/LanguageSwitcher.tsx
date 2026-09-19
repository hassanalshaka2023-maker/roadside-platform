"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";

/**
 * Switches locale while staying on the same page.
 *
 * `usePathname` from our i18n navigation returns the path WITHOUT the locale
 * prefix, so the same value can simply be re-rendered under the other locale.
 *
 * Rendered as links rather than a select so it works without JavaScript and
 * so each language is a real, crawlable URL.
 */
export function LanguageSwitcher({
  onDark = false,
  className,
}: {
  onDark?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const active = useLocale();
  const t = useTranslations("common");

  return (
    <nav aria-label={t("language")} className={cn("flex items-center gap-1", className)}>
      {routing.locales.map((locale) => {
        const isActive = locale === active;
        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "inline-flex min-h-touch items-center rounded-lg px-3 text-sm font-bold transition-colors",
              isActive
                ? "bg-brand-yellow text-ink"
                : onDark
                  ? "text-white hover:bg-white/10"
                  : "text-gray-600 hover:bg-gray-100",
            )}
          >
            {locale === "ar" ? t("arabic") : t("english")}
          </Link>
        );
      })}
    </nav>
  );
}
