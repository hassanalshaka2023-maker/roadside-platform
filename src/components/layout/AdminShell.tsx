"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Logo } from "@/components/ui/Logo";
import { LogoutButton } from "@/features/auth/components/LogoutButton";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { LanguageSwitcher } from "./LanguageSwitcher";

export interface AdminNavItem {
  /** Locale-less path, e.g. "/admin/requests". */
  href: string;
  label: string;
}

/**
 * Admin chrome: a fixed sidebar on desktop, a toggled drawer on mobile.
 *
 * The nav items are computed on the server from the user's permissions and
 * passed in, so a dispatcher never receives the Settings link at all. That is
 * a convenience, not the enforcement - the Settings page checks for itself.
 */
export function AdminShell({
  navItems,
  userName,
  levelLabel,
  children,
}: {
  navItems: AdminNavItem[];
  userName: string;
  levelLabel: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav aria-label={t("title")} className="flex flex-col gap-1 p-3">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            onClick={() => setOpen(false)}
            className={cn(
              "flex min-h-touch items-center rounded-lg px-3 text-sm font-bold transition-colors",
              isActive
                ? "bg-brand-yellow text-ink"
                : "text-gray-200 hover:bg-white/10",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Topbar */}
      <header className="dark-surface flex items-center justify-between gap-3 bg-ink p-3 text-white lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="admin-nav"
          aria-label={open ? t("closeMenu") : t("openMenu")}
          className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg hover:bg-white/10"
        >
          {open ? (
            <X aria-hidden="true" className="h-6 w-6" />
          ) : (
            <Menu aria-hidden="true" className="h-6 w-6" />
          )}
        </button>
        <Logo onDark />
        <LanguageSwitcher onDark />
      </header>

      {/* Sidebar / drawer */}
      <aside
        id="admin-nav"
        className={cn(
          "dark-surface bg-navy text-white lg:w-64 lg:shrink-0",
          open ? "block" : "hidden lg:block",
        )}
      >
        <div className="hidden p-4 lg:block">
          <Logo onDark showTagline />
        </div>

        {nav}

        <div className="border-t border-white/10 p-3">
          <p className="text-sm font-bold">{userName}</p>
          <p className="mb-2 text-xs text-brand-yellow">{levelLabel}</p>
          <div className="flex items-center justify-between gap-2">
            <LogoutButton variant="ghost" className="text-white hover:bg-white/10" />
            <span className="hidden lg:block">
              <LanguageSwitcher onDark />
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 bg-gray-50 p-4 sm:p-6">{children}</main>
    </div>
  );
}
