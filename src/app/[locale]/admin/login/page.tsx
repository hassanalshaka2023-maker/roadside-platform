import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { Card, CardBody } from "@/components/ui/Card";
import { Logo } from "@/components/ui/Logo";
import { AdminLoginForm } from "@/features/auth/components/AdminLoginForm";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * Staff sign-in. Deliberately outside the admin shell layout, so it does not
 * inherit the guard that would redirect it back to itself.
 */
export default async function AdminLoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (user?.role === "ADMIN") redirect(`/${locale}/admin`);

  const t = await getTranslations("auth");

  return (
    <div className="dark-surface flex min-h-dvh flex-col items-center justify-center bg-ink p-4">
      <div className="mb-6">
        <Logo size="xl" priority />
      </div>

      <Card className="w-full max-w-md">
        <CardBody className="p-6 sm:p-8">
          <h1 className="text-2xl">{t("adminLoginTitle")}</h1>
          <p className="mb-6 mt-2 text-sm text-gray-600">{t("adminLoginSubtitle")}</p>
          <AdminLoginForm />
        </CardBody>
      </Card>

      <div className="mt-6">
        <LanguageSwitcher onDark />
      </div>
    </div>
  );
}
