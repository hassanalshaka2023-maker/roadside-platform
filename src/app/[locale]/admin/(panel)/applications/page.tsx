import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { ApplicationStatusBadge } from "@/components/ui/StatusBadge";
import { listApplications } from "@/features/admin/queries";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { cn } from "@/lib/cn";
import { governorateName } from "@/lib/geo";

const FILTERS = ["PENDING_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED", "SUSPENDED"] as const;

export default async function AdminApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  await requirePermission(locale, "viewProviderApplications", "admin");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const status = FILTERS.find((f) => f === sp.status) ?? "PENDING_REVIEW";
  const rows = await listApplications(status);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl">{t("admin.applications")}</h1>
      <nav className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/applications?status=${f}`}
            className={cn("rounded-lg px-3 py-2 text-sm font-bold", f === status ? "bg-ink text-white" : "bg-white")}
          >
            {t(`applicationStatus.${f}`)}
          </Link>
        ))}
      </nav>
      <Card>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title={t("admin.noApplications")} />
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100">
              {rows.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/applications/${a.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-gray-50">
                    <span className="flex-1">
                      <span className="block font-bold">{a.fullName}</span>
                      <span className="block text-xs text-gray-500">
                        <bdi className="numeric">{a.publicReference}</bdi> · {governorateName(a.governorate, locale)} ·{" "}
                        {a.submittedAt ? format.dateTime(a.submittedAt, { dateStyle: "short", timeStyle: "short" }) : "—"}
                      </span>
                    </span>
                    <ApplicationStatusBadge status={a.status} />
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
