import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { requestOtpAction, verifyOtpAction } from "@/features/auth/actions";
import { CodeSignInForm } from "@/features/auth/components/CodeSignInForm";
import { PasswordLoginForm } from "@/features/auth/components/PasswordForms";
import { safeNextPath } from "@/features/auth/next-path";
import { Link } from "@/i18n/navigation";
import { loginChannels } from "@/lib/auth/channels";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * Two ways in:
 * - password (default): providers, by email or phone + password
 * - one-time code: first time (a new applicant proves their email/phone and
 *   then sets a password), and customers, who never need a password
 *
 * Someone arriving from "apply" has no account yet, so they start on the code.
 */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; mode?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const next = safeNextPath(query.next) ?? undefined;
  setRequestLocale(locale);

  // Already signed in: no reason to show a login form.
  const user = await getCurrentUser();
  if (user) redirect(`/${locale}${next ?? (user.role === "PROVIDER" ? "/provider" : "/account")}`);

  const t = await getTranslations();
  const mode = query.mode === "code" || (query.mode !== "password" && next === "/apply") ? "code" : "password";
  const otherMode = (m: "code" | "password") => `/login?mode=${m}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="container flex justify-center py-10 sm:py-16">
      <Card className="w-full max-w-md">
        <CardBody className="p-6 sm:p-8">
          <h1 className="text-2xl">{t("auth.loginTitle")}</h1>
          <p className="mb-6 mt-2 text-sm text-gray-600">
            {mode === "password" ? t("passwordAuth.loginSubtitle") : t("passwordAuth.codeSubtitle")}
          </p>

          {mode === "password" ? (
            <PasswordLoginForm next={next} />
          ) : (
            <CodeSignInForm
              channels={loginChannels()}
              sendAction={requestOtpAction}
              verifyAction={verifyOtpAction}
              hidden={next ? { next } : {}}
            />
          )}

          <div className="mt-6 flex flex-col gap-3 border-t border-gray-200 pt-5 text-center text-sm">
            {mode === "password" ? (
              <>
                <p className="text-gray-600">
                  {t("passwordAuth.firstTime")}{" "}
                  <Link href={otherMode("code")} className="font-bold text-ink underline underline-offset-4">
                    {t("passwordAuth.useCode")}
                  </Link>
                </p>
                <p className="text-gray-600">
                  {t("passwordAuth.wantToJoin")}{" "}
                  <Link href="/apply" className="font-bold text-ink underline underline-offset-4">
                    {t("passwordAuth.applyLink")}
                  </Link>
                </p>
              </>
            ) : (
              <p className="text-gray-600">
                {t("passwordAuth.haveAccount")}{" "}
                <Link href={otherMode("password")} className="font-bold text-ink underline underline-offset-4">
                  {t("passwordAuth.usePassword")}
                </Link>
              </p>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
