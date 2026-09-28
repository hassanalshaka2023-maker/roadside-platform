import { Menu, Siren, X } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Logo } from "@/components/ui/Logo";
import { LogoutButton } from "@/features/auth/components/LogoutButton";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { MobileMenu } from "./MobileMenu";

const secondaryLink =
  "inline-flex min-h-touch items-center rounded-lg px-3 text-sm font-bold text-white hover:bg-white/10";

/**
 * One row on every screen: logo, the "get help" button, and - on phones - a
 * menu for the rest. The menu is a <details> element, so it opens even
 * before the page has hydrated on a slow phone.
 */
export async function PublicHeader() {
  const [t, user] = await Promise.all([getTranslations("nav"), getCurrentUser()]);

  const links = (
    <>
      <Link href="/apply" className={secondaryLink}>
        {t("joinAsProvider")}
      </Link>
      {user ? (
        <>
          <Link href="/account" className={secondaryLink}>
            {t("myAccount")}
          </Link>
          <LogoutButton variant="ghost" className="text-white hover:bg-white/10" />
        </>
      ) : (
        <Link href="/login" className={secondaryLink}>
          {t("login")}
        </Link>
      )}
    </>
  );

  return (
    <header className="dark-surface sticky top-0 z-30 bg-ink text-white">
      <div className="container flex items-center justify-between gap-2 py-1.5">
        <Link href="/" className="inline-flex shrink-0 items-center" aria-label={t("home")}>
          <Logo priority />
        </Link>

        {/* Desktop */}
        <nav aria-label={t("home")} className="hidden items-center gap-2 md:flex">
          {links}
          <LanguageSwitcher onDark />
          <Link
            href="/request"
            className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-brand-yellow px-4 text-sm font-extrabold text-ink hover:bg-brand-yellow-hover"
          >
            <Siren aria-hidden="true" className="h-4 w-4" />
            {t("requestService")}
          </Link>
        </nav>

        {/* Phones */}
        <div className="flex items-center gap-1 md:hidden">
          <Link
            href="/request"
            className="inline-flex min-h-touch items-center gap-1.5 rounded-lg bg-brand-yellow px-3 text-sm font-extrabold text-ink hover:bg-brand-yellow-hover"
          >
            <Siren aria-hidden="true" className="h-4 w-4" />
            {t("requestService")}
          </Link>
          <MobileMenu className="group">
            <summary
              aria-label={t("menu")}
              className="inline-flex min-h-touch min-w-touch cursor-pointer list-none items-center justify-center rounded-lg hover:bg-white/10 [&::-webkit-details-marker]:hidden"
            >
              <Menu aria-hidden="true" className="h-6 w-6 group-open:hidden" />
              <X aria-hidden="true" className="hidden h-6 w-6 group-open:block" />
            </summary>
            <nav
              aria-label={t("home")}
              className="absolute inset-x-0 top-full flex flex-col gap-1 border-t border-white/10 bg-ink p-3 shadow-card"
            >
              {links}
              <LanguageSwitcher onDark className="pt-2" />
            </nav>
          </MobileMenu>
        </div>
      </div>
      <div className="hazard-divider" />
    </header>
  );
}
