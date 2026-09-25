import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { EmptyState, Field } from "@/components/ui/States";
import { setProviderServicesAction, settleCommissionAction, waiveCommissionAction } from "@/features/admin/actions";
import { getProviderAdmin } from "@/features/admin/queries";
import { getProviderEarnings, listCommissionEntries } from "@/features/commission/service";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { governorateName } from "@/lib/geo";
import { bpsToPercent } from "@/lib/money";
import { ContactNumber } from "@/components/ui/ContactNumber";

export default async function AdminProviderPage({ params }: { params: Promise<{ locale: string; userId: string }> }) {
  const { locale, userId } = await params;
  setRequestLocale(locale);

  const user = await requirePermission(locale, "viewProviders", "admin");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  const profile = await getProviderAdmin(userId);
  if (!profile) notFound();

  const [services, earnings, entries] = await Promise.all([
    prisma.serviceType.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, nameAr: true, nameEn: true } }),
    getProviderEarnings(userId),
    can(user, "manageCommission") ? listCommissionEntries(userId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/admin/providers" className="text-sm font-bold underline">{t("common.back")}</Link>
      <h1 className="text-2xl">{profile.user.name}</h1>

      <Card>
        <CardBody>
          <dl className="text-sm">
            <Field label={t("account.phone")}>
              <ContactNumber user={profile.user} />
            </Field>
            <Field label={t("apply.governorate")}>{governorateName(profile.governorate, locale) || "—"}</Field>
            <Field label={t("provider.profile.radius")}>{profile.serviceRadiusKm} km</Field>
            <Field label={t("provider.availability")}>{profile.isAvailable ? t("provider.available") : t("provider.unavailable")}</Field>
            <Field label={t("admin.accountStatus")}>{profile.status}</Field>
            <Field label={t("rating.title")}>
              {profile.ratingCount > 0 ? `★ ${profile.ratingAverage.toFixed(1)} (${profile.ratingCount})` : t("tracking.newProvider")}
            </Field>
            <Field label={t("provider.history.completedJobs")}>{earnings.completedJobs}</Field>
            <Field label={t("provider.history.serviceValue")}><Money amount={earnings.serviceValueSyp} /></Field>
            {profile.application ? (
              <Field label={t("admin.application")}>
                {can(user, "viewProviderApplications") ? (
                  <Link href={`/admin/applications/${profile.application.id}`} className="underline">
                    {profile.application.publicReference}
                  </Link>
                ) : (
                  profile.application.publicReference
                )}
              </Field>
            ) : null}
          </dl>
          <p className="mt-2 text-xs text-gray-500">{t("admin.suspendViaApplication")}</p>
        </CardBody>
      </Card>

      {can(user, "manageProviders") ? (
        <Card>
          <CardHeader><CardTitle>{t("admin.approvedServices")}</CardTitle></CardHeader>
          <CardBody>
            <ActionForm action={setProviderServicesAction} successMessage="admin.saved">
              <input type="hidden" name="userId" value={userId} />
              {services.map((s) => (
                <label key={s.id} className="flex min-h-touch items-center gap-3">
                  <input type="checkbox" name="serviceTypeIds" value={s.id} defaultChecked={profile.serviceTypeIds.includes(s.id)} className="h-5 w-5 accent-ink" />
                  {locale === "ar" ? s.nameAr : s.nameEn}
                </label>
              ))}
              <SubmitButton variant="secondary">{t("admin.save")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      {can(user, "manageCommission") ? (
        <Card>
          <CardHeader><CardTitle>{t("admin.ledger")}</CardTitle></CardHeader>
          <CardBody className="flex flex-col gap-3">
            <dl className="text-sm">
              <Field label={t("provider.history.commissionDue")}><Money amount={earnings.commissionDueSyp} /></Field>
              <Field label={t("provider.history.commissionSettled")}><Money amount={earnings.commissionSettledSyp} /></Field>
            </dl>
            {entries.length === 0 ? (
              <EmptyState title={t("admin.noEntries")} text={t("admin.noEntriesHint")} />
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <bdi className="numeric">{e.request.publicCode}</bdi> · {bpsToPercent(e.rateBps)}% · {format.dateTime(e.createdAt, { dateStyle: "short" })}
                    </span>
                    <span className="flex items-center gap-2">
                      <Money amount={e.amountSyp} /> · {t(`commissionStatus.${e.status}`)}
                      {e.status === "DUE" ? (
                        <ActionForm action={waiveCommissionAction}>
                          <input type="hidden" name="entryId" value={e.id} />
                          <SubmitButton size="sm" variant="ghost">{t("admin.waive")}</SubmitButton>
                        </ActionForm>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {earnings.commissionDueSyp > 0 ? (
              <ActionForm action={settleCommissionAction}>
                <input type="hidden" name="userId" value={userId} />
                <Input name="note" maxLength={300} placeholder={t("admin.settleNote")} />
                <SubmitButton variant="secondary">{t("admin.settleAll")}</SubmitButton>
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
