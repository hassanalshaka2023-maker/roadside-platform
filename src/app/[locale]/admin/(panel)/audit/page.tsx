import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/States";
import { listAudit } from "@/features/admin/queries";
import { requirePermission } from "@/lib/auth/current-user";

const GROUPS = ["file", "application", "offer", "request", "commission", "settings", "provider", "user", "auth", "rbac", "complaint", "extra"];

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  await requirePermission(locale, "viewAuditLog", "admin");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const group = GROUPS.find((g) => g === sp.action);
  const rows = await listAudit({ action: group });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-2xl">{t("admin.auditLog")}</h1>
      <form method="get" className="flex gap-2">
        <Select name="action" defaultValue={group ?? ""} className="w-auto">
          <option value="">{t("admin.allStatuses")}</option>
          {GROUPS.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </Select>
        <button type="submit" className="min-h-touch rounded-lg bg-ink px-4 font-bold text-white">{t("common.search")}</button>
      </form>
      <Card>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title={t("admin.noAudit")} />
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100 text-sm" dir="ltr">
              {rows.map((row) => (
                <li key={row.id} className="py-2">
                  <span className="text-gray-500">{format.dateTime(row.createdAt, { dateStyle: "short", timeStyle: "medium" })}</span>{" "}
                  <b>{row.action}</b> · {row.entityType} {row.entityId ? row.entityId.slice(0, 8) : ""} ·{" "}
                  {row.actor ? `${row.actor.name ?? row.actor.email ?? ""} (${row.actor.role})` : "system"}
                  {row.metadata && Object.keys(row.metadata as object).length > 0 ? (
                    <code className="mt-1 block break-all text-xs text-gray-600">{JSON.stringify(row.metadata).slice(0, 300)}</code>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
