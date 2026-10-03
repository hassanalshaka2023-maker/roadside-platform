import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Field, Notice } from "@/components/ui/States";
import { Textarea } from "@/components/ui/Textarea";
import {
  cancelScheduledCommissionAction,
  scheduleCommissionAction,
  toggleServiceAction,
  updateContactSettingsAction,
  updateMatchingSettingsAction,
} from "@/features/admin/actions";
import {
  earliestCommissionDate,
  effectiveCommission,
  readMatchingSettings,
  readSetting,
} from "@/features/settings/platform";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { bpsToPercent } from "@/lib/money";

/**
 * SUPER_ADMIN only (manageSettings). A DISPATCHER reaching this URL gets a
 * 404 from the guard - a server-side denial, not a hidden link.
 */
export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requirePermission(locale, "manageSettings", "admin");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

  const [matching, noticeDays, policy, phones, whatsapp, idMode, cancellation, services, hotline, noOfferMinutes] = await Promise.all([
    readMatchingSettings(),
    readSetting("commissionNoticeDays"),
    readSetting("commissionPolicy"),
    readSetting("businessPhones"),
    readSetting("whatsappEnabled"),
    readSetting("customerIdMode"),
    readSetting("cancellationPolicy"),
    prisma.serviceType.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, nameAr: true, nameEn: true, isActive: true } }),
    readSetting("hotlinePhone"),
    readSetting("noOfferHelpMinutes"),
  ]);
  const current = effectiveCommission(policy);
  const earliestInput = earliestCommissionDate(noticeDays);

  const numberField = (name: string, label: string, value: number, hint?: string) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-bold">{label}</span>
      <Input name={name} inputMode="numeric" dir="ltr" className="numeric" defaultValue={value} maxLength={4} />
      {hint ? <span className="text-xs text-gray-500">{hint}</span> : null}
    </label>
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl">{t("admin.settingsTitle")}</h1>

      <Card>
        <CardHeader><CardTitle>{t("admin.settingsMatching")}</CardTitle></CardHeader>
        <CardBody>
          <ActionForm action={updateMatchingSettingsAction} successMessage="admin.saved">
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField("searchRadiusKm", t("admin.searchRadiusKm"), matching.searchRadiusKm, t("admin.searchRadiusHint"))}
              {numberField("searchTimeoutMinutes", t("admin.searchTimeoutMinutes"), matching.searchTimeoutMinutes)}
              {numberField("offerValidityMinutes", t("admin.offerValidityMinutes"), matching.offerValidityMinutes)}
              {numberField("maxOffersPerRequest", t("admin.maxOffersPerRequest"), matching.maxOffersPerRequest)}
              {numberField("commissionNoticeDays", t("admin.commissionNoticeDays"), noticeDays)}
            </div>
            <SubmitButton variant="secondary">{t("admin.save")}</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("admin.settingsCommission")}</CardTitle></CardHeader>
        <CardBody className="flex flex-col gap-4">
          <dl className="text-sm">
            <Field label={t("admin.commissionCurrent")}>
              {current.enabled && current.rateBps > 0
                ? `${bpsToPercent(current.rateBps)}% — ${t(`provider.commissionBase.${current.base}`)}`
                : t("admin.commissionFreeShort")}
            </Field>
            {policy.scheduled ? (
              <Field label={t("admin.commissionScheduled")}>
                {policy.scheduled.enabled ? `${bpsToPercent(policy.scheduled.rateBps)}% — ${t(`provider.commissionBase.${policy.scheduled.base}`)}` : t("admin.commissionFreeShort")}
                {" · "}
                {format.dateTime(new Date(policy.scheduled.effectiveFrom), { dateStyle: "long" })}
              </Field>
            ) : null}
          </dl>
          <Notice tone="info">{t("admin.commissionRules", { days: noticeDays })}</Notice>
          {can(user, "manageCommission") ? (
            <>
              <ActionForm action={scheduleCommissionAction} successMessage="admin.saved">
                <label className="flex min-h-touch items-center gap-3">
                  <input type="checkbox" name="enabled" className="h-5 w-5 accent-ink" />
                  {t("admin.commissionEnable")}
                </label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="flex flex-col gap-1.5 text-sm font-bold">
                    {t("admin.commissionRate")}
                    <Input name="ratePercent" inputMode="decimal" dir="ltr" className="numeric" placeholder="0" maxLength={6} />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-bold">
                    {t("admin.commissionBaseLabel")}
                    <Select name="base" defaultValue="TOTAL">
                      <option value="TOTAL">{t("provider.commissionBase.TOTAL")}</option>
                      <option value="LABOR">{t("provider.commissionBase.LABOR")}</option>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-bold">
                    {t("admin.effectiveFrom")}
                    <Input type="date" name="effectiveFrom" dir="ltr" min={earliestInput} defaultValue={earliestInput} required />
                  </label>
                </div>
                <SubmitButton variant="secondary">{t("admin.commissionSchedule")}</SubmitButton>
              </ActionForm>
              {policy.scheduled ? (
                <ActionForm action={cancelScheduledCommissionAction}>
                  <SubmitButton variant="ghost" size="sm">{t("admin.commissionCancelScheduled")}</SubmitButton>
                </ActionForm>
              ) : null}
            </>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("admin.settingsContact")}</CardTitle></CardHeader>
        <CardBody>
          <ActionForm action={updateContactSettingsAction} successMessage="admin.saved">
            <label className="flex flex-col gap-1.5 text-sm font-bold">
              {t("admin.businessPhones")}
              <Input name="businessPhones" dir="ltr" className="numeric" defaultValue={phones.join(" ")} maxLength={80} />
              <span className="text-xs font-normal text-gray-500">{t("admin.businessPhonesHint")}</span>
            </label>
            <label className="flex min-h-touch items-center gap-3">
              <input type="checkbox" name="whatsappEnabled" defaultChecked={whatsapp} className="h-5 w-5 accent-ink" />
              {t("admin.whatsappEnabled")}
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-bold">
                {t("admin.hotlinePhone")}
                <Input name="hotlinePhone" dir="ltr" inputMode="tel" className="numeric" defaultValue={hotline} maxLength={10} />
                <span className="text-xs font-normal text-gray-500">{t("admin.hotlinePhoneHint")}</span>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-bold">
                {t("admin.noOfferHelpMinutes")}
                <Input name="noOfferHelpMinutes" dir="ltr" inputMode="numeric" className="numeric" defaultValue={noOfferMinutes} maxLength={2} />
                <span className="text-xs font-normal text-gray-500">{t("admin.noOfferHelpMinutesHint")}</span>
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-bold">
              {t("admin.customerIdMode")}
              <Select name="customerIdMode" defaultValue={idMode}>
                {(["NEVER", "FIRST_REQUEST_ONLY", "ALWAYS"] as const).map((m) => (
                  <option key={m} value={m}>{t(`admin.idMode_${m}`)}</option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-bold">
              {t("admin.cancellationPolicyAr")}
              <Textarea name="cancellationPolicyAr" rows={3} maxLength={2000} defaultValue={cancellation.ar} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-bold">
              {t("admin.cancellationPolicyEn")}
              <Textarea name="cancellationPolicyEn" rows={3} maxLength={2000} defaultValue={cancellation.en} dir="ltr" />
            </label>
            <SubmitButton variant="secondary">{t("admin.save")}</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("admin.settingsServices")}</CardTitle></CardHeader>
        <CardBody className="flex flex-col gap-2">
          {services.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2">
              <span className="font-bold">
                {locale === "ar" ? s.nameAr : s.nameEn} <Badge tone={s.isActive ? "success" : "neutral"}>{s.isActive ? t("admin.active_on") : t("admin.active_off")}</Badge>
              </span>
              <ActionForm action={toggleServiceAction}>
                <input type="hidden" name="serviceTypeId" value={s.id} />
                <input type="hidden" name="isActive" value={s.isActive ? "false" : "true"} />
                <SubmitButton size="sm" variant="outline">{s.isActive ? t("admin.disable") : t("admin.enable")}</SubmitButton>
              </ActionForm>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
