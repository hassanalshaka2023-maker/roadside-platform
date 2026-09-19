import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { requirePermission } from "@/lib/auth/current-user";

/**
 * SUPER_ADMIN only.
 *
 * The guard asks for the `manageSettings` permission rather than for the
 * SUPER_ADMIN role, so if a third admin level is ever added, only the
 * permission map has to change.
 *
 * A DISPATCHER reaching this URL directly gets a 404 from the guard - a
 * server-side denial, not a redirect, and not a confirmation that the page
 * exists.
 */
export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requirePermission(locale, "manageSettings", "admin");
  const t = await getTranslations("admin");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl">{t("settingsTitle")}</h1>
      <p className="mt-2 text-gray-600">{t("settingsRestricted")}</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("placeholderTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-gray-600">{t("placeholderText")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
