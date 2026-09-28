"use client";

import { LogOut } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { logoutAction } from "../actions";

export function LogoutButton({
  variant = "ghost",
  className,
  compact = false,
}: {
  variant?: "ghost" | "outline" | "secondary";
  className?: string;
  /** Icon only on phones (the label stays for screen readers). */
  compact?: boolean;
}) {
  const t = useTranslations("nav");
  const locale = useLocale();

  return (
    <form action={logoutAction}>
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant={variant} size="sm" className={className} aria-label={compact ? t("logout") : undefined}>
        <LogOut aria-hidden="true" className="h-4 w-4 shrink-0 rtl:rotate-180" />
        <span className={compact ? "hidden whitespace-nowrap sm:inline" : "whitespace-nowrap"}>{t("logout")}</span>
      </Button>
    </form>
  );
}
