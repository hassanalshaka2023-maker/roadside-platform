import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { ForgotPasswordForm } from "@/features/auth/components/PasswordForms";
import { Link } from "@/i18n/navigation";
import { loginChannels } from "@/lib/auth/channels";
import { getCurrentUser } from "@/lib/auth/current-user";

/** "Forgot password": a code to the account's email/phone, then a new password. */
export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Signed in already: changing the password lives on the account page.
  if (await getCurrentUser()) redirect(`/${locale}/account/password`);

  const t = await getTranslations();

  return (
    <div className="container flex justify-center py-10 sm:py-16">
      <Card className="w-full max-w-md">
        <CardBody className="p-6 sm:p-8">
          <h1 className="text-2xl">{t("passwordAuth.forgotTitle")}</h1>
          <p className="mb-6 mt-2 text-sm text-gray-600">{t("passwordAuth.forgotSubtitle")}</p>
          <ForgotPasswordForm channels={loginChannels()} />
          <p className="mt-6 border-t border-gray-200 pt-5 text-center text-sm">
            <Link href="/login" className="font-bold text-ink underline underline-offset-4">
              {t("passwordAuth.backToLogin")}
            </Link>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
