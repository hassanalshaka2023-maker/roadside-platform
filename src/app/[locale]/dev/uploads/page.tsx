import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isProduction } from "@/lib/env";
import { Link } from "@/i18n/navigation";
import { UploadPlayground } from "./UploadPlayground";

/**
 * Development-only harness for the upload pipeline.
 *
 * Returns 404 in production - checked here on the server, not hidden in the
 * UI. There is no route guard that would otherwise stop this URL from
 * existing on a live deployment.
 *
 * force-dynamic matters: without it Next prerenders this page at build time,
 * so the environment check would reflect whatever NODE_ENV the BUILD ran
 * under rather than the one the server is actually running under.
 */
export const dynamic = "force-dynamic";
export default async function DevUploadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (isProduction) notFound();

  const { locale } = await params;
  setRequestLocale(locale);

  const [t, user] = await Promise.all([getTranslations("dev"), getCurrentUser()]);

  return (
    <div className="container max-w-2xl py-8">
      <h1 className="text-2xl">{t("title")}</h1>
      <p className="mb-6 mt-2 text-sm text-gray-600">{t("subtitle")}</p>

      {!user ? (
        <Card>
          <CardBody className="text-center">
            <p className="mb-4">{t("loginFirst")}</p>
            <Link
              href="/login"
              className="inline-flex min-h-touch items-center rounded-lg bg-brand-yellow px-5 font-extrabold text-ink"
            >
              {t("loginFirst")}
            </Link>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{t("currentUser")}</CardTitle>
            </CardHeader>
            <CardBody className="text-sm">
              <p>
                <span className="font-bold">id:</span>{" "}
                <span className="font-mono">{user.id}</span>
              </p>
              <p>
                <span className="font-bold">role:</span> {user.role}
                {user.adminLevel ? ` / ${user.adminLevel}` : ""}
              </p>
            </CardBody>
          </Card>

          <UploadPlayground />
        </>
      )}
    </div>
  );
}
