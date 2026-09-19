"use client";

import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { logoutAction } from "../actions";

export function LogoutButton({
  variant = "ghost",
  className,
}: {
  variant?: "ghost" | "outline" | "secondary";
  className?: string;
}) {
  const t = useTranslations("nav");
  const locale = useLocale();

  return (
    <form action={logoutAction}>
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant={variant} size="sm" className={className}>
        {t("logout")}
      </Button>
    </form>
  );
}
