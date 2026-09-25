import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { directionOf, routing } from "@/i18n/routing";

import "../globals.css";

/**
 * Cairo is the brand typeface. next/font downloads and self-hosts it at build
 * time, so there is no runtime request to Google - better for privacy, and it
 * still works if Google Fonts is unreachable from the user's network.
 *
 * Only three weights are loaded: Arabic fonts are heavy, and our users are on
 * weak connections. 800 covers the "heavy heading" look from the flyer.
 */
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "800"],
  variable: "--font-cairo",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: t("title"),
    description: t("description"),
    // The app is not meant to be indexed piecemeal by locale-less URLs.
    alternates: {
      languages: { ar: "/ar", en: "/en" },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Enables static rendering for this locale's pages.
  setRequestLocale(locale);

  return (
    <html lang={locale} dir={directionOf(locale)} className={cairo.variable}>
      <body className="min-h-dvh bg-white text-ink">
        <NextIntlClientProvider>
          <OfflineBanner />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
