import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { CustomerLoginForm } from "@/features/auth/components/CustomerLoginForm";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Already signed in: no reason to show a login form.
  const user = await getCurrentUser();
  if (user) redirect(`/${locale}/account`);

  const t = await getTranslations("auth");

  return (
    <div className="container flex justify-center py-10 sm:py-16">
      <Card className="w-full max-w-md">
        <CardBody className="p-6 sm:p-8">
          <h1 className="text-2xl">{t("loginTitle")}</h1>
          <p className="mb-6 mt-2 text-sm text-gray-600">{t("loginSubtitle")}</p>
          <CustomerLoginForm />
        </CardBody>
      </Card>
    </div>
  );
}
