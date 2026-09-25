import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/States";
import { updateComplaintAction } from "@/features/admin/actions";
import { listComplaints } from "@/features/admin/queries";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { cn } from "@/lib/cn";

const STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"] as const;

export default async function AdminComplaintsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  await requirePermission(locale, "manageComplaints", "admin");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const status = STATUSES.find((s) => s === sp.status);
  const rows = await listComplaints(status);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl">{t("admin.complaints")}</h1>
      <nav className="flex flex-wrap gap-2">
        <Link href="/admin/complaints" className={cn("rounded-lg px-3 py-2 text-sm font-bold", !status ? "bg-ink text-white" : "bg-white")}>
          {t("admin.allStatuses")}
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/complaints?status=${s}`} className={cn("rounded-lg px-3 py-2 text-sm font-bold", s === status ? "bg-ink text-white" : "bg-white")}>
            {t(`complaintStatus.${s}`)}
          </Link>
        ))}
      </nav>
      <Card>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title={t("admin.noComplaints")} />
          ) : (
            <ul className="flex flex-col gap-4">
              {rows.map((c) => (
                <li key={c.id} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge tone="warning">{t(`complaint.category.${c.category}`)}</Badge>
                      <Link href={`/admin/requests/${c.request.id}`} className="font-bold underline">
                        <bdi className="numeric">{c.request.publicCode}</bdi>
                      </Link>
                    </span>
                    <Badge>{t(`complaintStatus.${c.status}`)}</Badge>
                  </div>
                  <p className="mt-2">{c.description}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {c.filedBy.name ?? "—"} ({c.filedBy.role === "PROVIDER" ? t("account.roleProvider") : t("account.roleCustomer")}) ·{" "}
                    {format.dateTime(c.createdAt, { dateStyle: "short", timeStyle: "short" })}
                  </p>
                  {c.adminNote ? <p className="mt-1 text-sm text-gray-700">{t("admin.note")}: {c.adminNote}</p> : null}
                  <ActionForm action={updateComplaintAction} className="mt-3 flex-row flex-wrap items-center">
                    <input type="hidden" name="complaintId" value={c.id} />
                    <Select name="status" defaultValue={c.status} className="w-auto">
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{t(`complaintStatus.${s}`)}</option>
                      ))}
                    </Select>
                    <Input name="adminNote" maxLength={1000} placeholder={t("admin.note")} className="w-auto flex-1" />
                    <SubmitButton size="sm" variant="secondary">{t("admin.save")}</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
