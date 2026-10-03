import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { SetPasswordForm } from "@/features/auth/components/PasswordForms";
import { safeNextPath } from "@/features/auth/next-path";
import { requireUser } from "@/lib/auth/current-user";

/**
 * Set a password (first time, right after proving the email/phone with a
 * code) or change it. Providers are sent here until they have one.
 */
export default async function PasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser(locale);
  // Staff have their own credentials page.
  if (user.role === "ADMIN") notFound();

  const next = safeNextPath((await searchParams).next) ?? undefined;
  const t = await getTranslations("passwordAuth");

  return (
    <div className="container flex justify-center py-10 sm:py-16">
      <Card className="w-full max-w-md">
        <CardBody className="p-6 sm:p-8">
          <h1 className="text-2xl">{user.hasPassword ? t("changeTitle") : t("setTitle")}</h1>
          <p className="mb-6 mt-2 text-sm text-gray-600">
            {user.hasPassword ? t("changeSubtitle") : t("setSubtitle")}
          </p>
          <SetPasswordForm hasPassword={user.hasPassword} next={next} />
        </CardBody>
      </Card>
    </div>
  );
}
