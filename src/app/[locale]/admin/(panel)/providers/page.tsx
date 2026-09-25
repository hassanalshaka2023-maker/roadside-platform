import { getTranslations, setRequestLocale } from "next-intl/server";

import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { listProviders } from "@/features/admin/queries";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { governorateName } from "@/lib/geo";
import { ContactNumber } from "@/components/ui/ContactNumber";

export default async function AdminProvidersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requirePermission(locale, "viewProviders", "admin");
  const t = await getTranslations();
  const rows = await listProviders();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl">{t("admin.providers")}</h1>
      <Card>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title={t("admin.noProviders")} />
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100">
              {rows.map((p) => (
                <li key={p.userId}>
                  <Link href={`/admin/providers/${p.userId}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-gray-50">
                    <span className="flex-1">
                      <span className="block font-bold">{p.user.name}</span>
                      <span className="block text-xs text-gray-500">
                        <ContactNumber user={p.user} fallback="" /> · {governorateName(p.governorate, locale)} ·{" "}
                        {t("tracking.jobsDone", { count: p.completedJobs })}
                        {p.ratingCount > 0 ? ` · ★ ${p.ratingAverage.toFixed(1)} (${p.ratingCount})` : ""}
                      </span>
                    </span>
                    <Badge tone={p.status === "ACTIVE" ? (p.isAvailable ? "success" : "neutral") : "danger"}>
                      {p.status !== "ACTIVE" ? t("applicationStatus.SUSPENDED") : p.isAvailable ? t("provider.available") : t("provider.unavailable")}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
