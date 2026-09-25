import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { listRequests } from "@/features/admin/queries";
import { sweepQuietly } from "@/features/requests/service";
import { ALL_STATUSES, type RequestStatusName } from "@/features/requests/state-machine";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { governorateName } from "@/lib/geo";
import { ContactNumber } from "@/components/ui/ContactNumber";

export default async function AdminRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  await requirePermission(locale, "viewAllRequests", "admin");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

  const status = ALL_STATUSES.includes(sp.status as RequestStatusName) ? (sp.status as RequestStatusName) : undefined;
  const q = (sp.q ?? "").slice(0, 40);

  await sweepQuietly();
  const rows = await listRequests({ status, q: q || undefined });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-2xl">{t("admin.requests")}</h1>

      <form className="flex flex-wrap gap-2" method="get">
        <Select name="status" defaultValue={status ?? ""} className="w-auto">
          <option value="">{t("admin.allStatuses")}</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
        <Input name="q" defaultValue={q} placeholder={t("admin.searchRequests")} className="w-auto flex-1" />
        <button type="submit" className="min-h-touch rounded-lg bg-ink px-4 font-bold text-white">
          {t("common.search")}
        </button>
      </form>

      <Card>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title={t("admin.noRequests")} />
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/requests/${r.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-gray-50">
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">
                        <bdi className="numeric">{r.publicCode}</bdi> · {locale === "ar" ? r.serviceType.nameAr : r.serviceType.nameEn}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {governorateName(r.governorate, locale)} · {format.dateTime(r.createdAt, { dateStyle: "short", timeStyle: "short" })} ·{" "}
                        {r.customer.name ?? ""} <ContactNumber user={r.customer} fallback="" />
                        {r.assignedProvider ? ` → ${r.assignedProvider.name ?? ""}` : ""}
                        {r._count.offers > 0 ? ` · ${t("provider.offersCount", { count: r._count.offers })}` : ""}
                      </span>
                    </span>
                    {r.finalAmountSyp !== null ? <Money amount={r.finalAmountSyp} className="text-sm font-bold" /> : null}
                    <StatusBadge status={r.status} />
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
