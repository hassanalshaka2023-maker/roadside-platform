import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/States";
import { setUserStatusAction } from "@/features/admin/actions";
import { listCustomers } from "@/features/admin/queries";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { ContactNumber } from "@/components/ui/ContactNumber";

export default async function AdminCustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const q = ((await searchParams).q ?? "").slice(0, 40);
  setRequestLocale(locale);

  const user = await requirePermission(locale, "viewCustomers", "admin");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const rows = await listCustomers(q || undefined);
  const manage = can(user, "manageUsers");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl">{t("admin.customers")}</h1>
      <form method="get" className="flex gap-2">
        <Input name="q" defaultValue={q} placeholder={t("admin.searchUsers")} />
        <button type="submit" className="min-h-touch rounded-lg bg-ink px-4 font-bold text-white">{t("common.search")}</button>
      </form>
      <Card>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title={t("admin.noUsers")} />
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100">
              {rows.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex-1">
                    <span className="block font-bold">{u.name ?? "—"}</span>
                    <span className="block text-xs text-gray-500">
                      <ContactNumber user={u} fallback="" /> ·{" "}
                      {u.role === "PROVIDER" ? t("account.roleProvider") : t("account.roleCustomer")} · {t("admin.requestCount", { count: u._count.requestsAsCustomer })} ·{" "}
                      {format.dateTime(u.createdAt, { dateStyle: "short" })}
                    </span>
                  </span>
                  <Badge tone={u.status === "ACTIVE" ? "success" : "danger"}>{t(`userStatus.${u.status}`)}</Badge>
                  {manage ? (
                    <ActionForm action={setUserStatusAction} className="flex-row items-center">
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="status" value={u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} />
                      <Input name="reason" required minLength={3} maxLength={300} placeholder={t("admin.reason")} className="w-40" />
                      <SubmitButton size="sm" variant={u.status === "ACTIVE" ? "danger" : "secondary"}>
                        {u.status === "ACTIVE" ? t("admin.suspend") : t("admin.activate")}
                      </SubmitButton>
                    </ActionForm>
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
