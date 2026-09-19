import { getTranslations, setRequestLocale } from "next-intl/server";

import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

export default async function ProviderDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireRole(locale, ["PROVIDER"], "customer");
  const t = await getTranslations("provider");

  const profile = await prisma.providerProfile.findUnique({
    where: { userId: user.id },
    select: { isAvailable: true },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-lg font-extrabold">
        {t("welcome", { name: user.name ?? "" })}
      </p>

      <Card className="mt-4">
        <CardBody className="flex items-center justify-between gap-4">
          <span className="font-bold text-gray-600">{t("availability")}</span>
          <Badge tone={profile?.isAvailable ? "success" : "neutral"}>
            {profile?.isAvailable ? t("available") : t("unavailable")}
          </Badge>
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t("myJobs")}</CardTitle>
        </CardHeader>
        <CardBody>
          {/* Empty state; the real job list arrives with phase 5. */}
          <p className="py-6 text-center text-gray-600">{t("noJobs")}</p>
          <p className="text-center text-sm text-gray-500">
            {t("placeholderText")}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
