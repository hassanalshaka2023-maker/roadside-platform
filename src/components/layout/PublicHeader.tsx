import { getTranslations } from "next-intl/server";

import { LogoutButton } from "@/features/auth/components/LogoutButton";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Logo } from "@/components/ui/Logo";

export async function PublicHeader() {
  const [t, user] = await Promise.all([getTranslations("nav"), getCurrentUser()]);

  return (
    <header className="dark-surface bg-ink text-white">
      <div className="container flex flex-wrap items-center justify-between gap-3 py-3">
        <Link href="/" className="inline-flex items-center" aria-label={t("home")}>
          <Logo onDark showTagline />
        </Link>

        <nav
          aria-label={t("home")}
          className="flex flex-wrap items-center gap-2 sm:gap-3"
        >
          <Link
            href="/request"
            className="inline-flex min-h-touch items-center rounded-lg bg-brand-yellow px-4 text-sm font-extrabold text-ink hover:bg-brand-yellow-hover"
          >
            {t("requestService")}
          </Link>

          <Link
            href="/apply"
            className="inline-flex min-h-touch items-center rounded-lg px-3 text-sm font-bold text-white hover:bg-white/10"
          >
            {t("joinAsProvider")}
          </Link>

          {user ? (
            <>
              <Link
                href="/account"
                className="inline-flex min-h-touch items-center rounded-lg px-3 text-sm font-bold text-white hover:bg-white/10"
              >
                {t("myAccount")}
              </Link>
              <LogoutButton variant="ghost" className="text-white hover:bg-white/10" />
            </>
          ) : (
            <Link
              href="/login"
              className="inline-flex min-h-touch items-center rounded-lg px-3 text-sm font-bold text-white hover:bg-white/10"
            >
              {t("login")}
            </Link>
          )}

          <LanguageSwitcher onDark />
        </nav>
      </div>
      <div className="hazard-divider" />
    </header>
  );
}
