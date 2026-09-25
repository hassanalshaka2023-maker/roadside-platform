import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { requestOtpAction, verifyOtpAction } from "@/features/auth/actions";
import { CodeSignInForm } from "@/features/auth/components/CodeSignInForm";
import { loginChannels } from "@/lib/auth/channels";
import { safeNextPath } from "@/features/auth/next-path";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const next = safeNextPath((await searchParams).next) ?? undefined;
  setRequestLocale(locale);

  // Already signed in: no reason to show a login form.
  const user = await getCurrentUser();
  if (user) redirect(`/${locale}${next ?? (user.role === "PROVIDER" ? "/provider" : "/account")}`);

  const t = await getTranslations("auth");

  return (
    <div className="container flex justify-center py-10 sm:py-16">
      <Card className="w-full max-w-md">
        <CardBody className="p-6 sm:p-8">
          <h1 className="text-2xl">{t("loginTitle")}</h1>
          <p className="mb-6 mt-2 text-sm text-gray-600">{t("loginSubtitle")}</p>
          <CodeSignInForm
            channels={loginChannels()}
            sendAction={requestOtpAction}
            verifyAction={verifyOtpAction}
            hidden={next ? { next } : {}}
          />
        </CardBody>
      </Card>
    </div>
  );
}
