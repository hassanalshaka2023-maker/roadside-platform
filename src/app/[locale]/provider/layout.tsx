import { getTranslations, setRequestLocale } from "next-intl/server";

import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { Logo } from "@/components/ui/Logo";
import { LogoutButton } from "@/features/auth/components/LogoutButton";
import { Link } from "@/i18n/navigation";
import { ProviderTabs } from "@/components/layout/ProviderTabs";
import { InstallAppBanner } from "@/components/pwa/InstallAppBanner";
import { requireRole } from "@/lib/auth/current-user";

/**
 * Provider area. PROVIDER role only - which an account gets from an admin's
 * approval, never from filling in the form.
 *
 * Kept deliberately plain: providers are on phones, often outdoors, often on
 * a weak connection.
 */
export default async function ProviderLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireRole(locale, ["PROVIDER"], "customer");
  const t = await getTranslations("provider");

  const nav = [
    { href: "/provider", label: t("nav.dashboard") },
    { href: "/provider/history", label: t("nav.history") },
    { href: "/provider/profile", label: t("nav.profile") },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="dark-surface bg-ink text-white">
        <div className="flex items-center justify-between gap-3 p-3">
          <Link href="/provider" aria-label={t("title")}>
            <Logo size="sm" priority />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher onDark />
            <LogoutButton compact variant="ghost" className="text-white hover:bg-white/10" />
          </div>
        </div>
        <ProviderTabs label={t("title")} items={nav} />
      </header>
      <div className="hazard-divider" />

      <main className="flex-1 bg-gray-50 p-4">
        <h1 className="sr-only">{t("title")}</h1>
        <div className="mx-auto max-w-2xl">
          <InstallAppBanner className="mb-4" />
          {children}
        </div>
      </main>
    </div>
  );
}
