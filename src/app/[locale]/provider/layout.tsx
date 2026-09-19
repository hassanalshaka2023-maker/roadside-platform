import { getTranslations, setRequestLocale } from "next-intl/server";

import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { Logo } from "@/components/ui/Logo";
import { LogoutButton } from "@/features/auth/components/LogoutButton";
import { requireRole } from "@/lib/auth/current-user";

/**
 * Provider area. PROVIDER role only - an admin is not a provider and has no
 * jobs, so they are denied here too.
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

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="dark-surface flex items-center justify-between gap-3 bg-ink p-3 text-white">
        <Logo onDark />
        <div className="flex items-center gap-2">
          <LanguageSwitcher onDark />
          <LogoutButton variant="ghost" className="text-white hover:bg-white/10" />
        </div>
      </header>
      <div className="hazard-divider" />

      <main className="flex-1 bg-gray-50 p-4">
        <h1 className="sr-only">{t("title")}</h1>
        {children}
      </main>
    </div>
  );
}
