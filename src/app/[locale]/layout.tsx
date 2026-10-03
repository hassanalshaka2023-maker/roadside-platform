import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { directionOf, routing } from "@/i18n/routing";
import { env } from "@/lib/env";

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
  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: "metadata" }),
    getTranslations({ locale, namespace: "common" }),
  ]);

  return {
    // Absolute URLs for the link preview (opengraph-image.jpg) and icons.
    metadataBase: new URL(env.APP_URL),
    title: t("title"),
    description: t("description"),
    openGraph: { siteName: t("title"), locale: locale === "ar" ? "ar_SY" : "en_US", type: "website" },
    // The app is not meant to be indexed piecemeal by locale-less URLs.
    alternates: {
      languages: { ar: "/ar", en: "/en" },
    },
    // iPhone "Add to Home Screen": open full-screen with our name under the
    // icon. The manifest (src/app/manifest.ts) covers Android.
    appleWebApp: { capable: true, title: tc("appName"), statusBarStyle: "black" },
  };
}

/** Colours the phone's status bar to match the dark header. */
export const viewport: Viewport = {
  themeColor: "#0B0B0F",
};

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
          <ServiceWorkerRegistration />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
