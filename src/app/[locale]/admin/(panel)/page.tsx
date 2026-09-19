import { getTranslations, setRequestLocale } from "next-intl/server";

import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireAdmin } from "@/lib/auth/current-user";
import { permissionsFor } from "@/lib/auth/permissions";

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Checked again here, not only in the layout.
  const user = await requireAdmin(locale);
  const t = await getTranslations("admin");

  const permissions = permissionsFor(user);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl">{t("title")}</h1>
      <p className="mt-2 text-gray-600">
        {t("welcome", { name: user.name ?? user.email ?? "" })}
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("placeholderTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-gray-600">{t("placeholderText")}</p>

          {/*
            Rendering the effective permission set is genuinely useful while
            building: it makes the RBAC map visible instead of something you
            have to infer from which links happen to appear.
          */}
          <ul className="mt-4 flex flex-wrap gap-2">
            {permissions.map((permission) => (
              <li key={permission}>
                <Badge tone="neutral">{permission}</Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
