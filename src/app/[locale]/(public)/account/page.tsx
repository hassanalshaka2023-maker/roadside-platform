import { getTranslations, setRequestLocale } from "next-intl/server";

import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireUser } from "@/lib/auth/current-user";
import { toLocalFormat } from "@/lib/phone";

/**
 * Example protected route: any signed-in user.
 *
 * The guard runs here, on the server, not in middleware.
 */
export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser(locale, "customer");
  const t = await getTranslations("account");

  const roleLabel =
    user.role === "ADMIN"
      ? t("roleAdmin")
      : user.role === "PROVIDER"
        ? t("roleProvider")
        : t("roleCustomer");

  return (
    <div className="container max-w-2xl py-10">
      <h1 className="text-2xl">{t("title")}</h1>
      <p className="mb-6 mt-2 text-sm text-gray-600">{t("subtitle")}</p>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-bold text-gray-600">{t("phone")}</span>
            <span dir="ltr" className="numeric font-bold">
              {user.phone ? toLocalFormat(user.phone) : "—"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-bold text-gray-600">{t("name")}</span>
            <span className={user.name ? "font-bold" : "text-gray-500"}>
              {user.name ?? t("noName")}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-bold text-gray-600">{t("role")}</span>
            <Badge tone="yellow">{roleLabel}</Badge>
          </div>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("myRequests")}</CardTitle>
        </CardHeader>
        <CardBody>
          {/* Empty state now; the real list arrives with phase 3. */}
          <p className="py-6 text-center text-gray-600">{t("noRequestsYet")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
