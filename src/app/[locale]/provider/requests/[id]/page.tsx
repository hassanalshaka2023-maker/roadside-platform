import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { Field, Notice } from "@/components/ui/States";
import { submitOfferAction, withdrawOfferAction } from "@/features/jobs/actions";
import { listOpenRequestsForProvider } from "@/features/matching/queries";
import { readMatchingSettings } from "@/features/settings/platform";
import { Link } from "@/i18n/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { governorateName } from "@/lib/geo";

/**
 * An open request as a CANDIDATE provider sees it: governorate, neighbourhood
 * and landmark as typed by the customer, approximate distance, destination,
 * the car and the problem - never the exact pin, photos or the customer. Reachable only if this provider is eligible right now;
 * otherwise it simply does not exist for them.
 */
export default async function ProviderRequestPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const user = await requireRole(locale, ["PROVIDER"], "customer");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

  const [{ items }, settings] = await Promise.all([listOpenRequestsForProvider(user.id), readMatchingSettings()]);
  const item = items.find((i) => i.id === id);
  if (!item) notFound();

  const service = await prisma.serviceType.findFirst({
    where: { slug: item.serviceType.slug },
    select: { pricingNoteAr: true, pricingNoteEn: true },
  });
  const pricingNote = locale === "ar" ? service?.pricingNoteAr : service?.pricingNoteEn;
  const amountInput = (name: string, label: string, required = false) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-bold">
        {label} {required ? <span className="text-brand-red">*</span> : null}
      </span>
      <Input name={name} inputMode="numeric" dir="ltr" className="numeric" placeholder="0" defaultValue="" maxLength={13} />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <Link href="/provider" className="text-sm font-bold underline">
        {t("common.back")}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>{locale === "ar" ? item.serviceType.nameAr : item.serviceType.nameEn}</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="text-sm">
            <Field label={t("wizard.governorate")}>{governorateName(item.governorate, locale)}</Field>
            {item.areaText ? <Field label={t("wizard.address")}>{item.areaText}</Field> : null}
            {item.landmark ? <Field label={t("wizard.landmark")}>{item.landmark}</Field> : null}
            {item.approxDistanceKm !== null ? (
              <Field label={t("provider.distanceLabel")}>{t("provider.distance", { km: item.approxDistanceKm })}</Field>
            ) : null}
            {item.destinationText ? <Field label={t("provider.destinationLabel")}>{item.destinationText}</Field> : null}
            {item.towDistanceKm !== null ? (
              <Field label={t("provider.towDistanceLabel")}>{t("provider.towDistance", { km: item.towDistanceKm })}</Field>
            ) : null}
            <Field label={t("wizard.car")}>
              {[
                [item.carMake, item.carModel, item.carYear].filter(Boolean).join(" "),
                item.carCategory ? t(`vehicleCategory.${item.carCategory}`) : "",
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            </Field>
            {item.vehicleCanRoll !== null ? (
              <Field label={t("wizard.canRoll")}>{t(item.vehicleCanRoll ? "wizard.canRoll_yes" : "wizard.canRoll_no")}</Field>
            ) : null}
            <Field label={t("wizard.problem")}>{item.problemUnknown ? t("wizard.dontKnow") : item.problemDescription || "—"}</Field>
            <Field label={t("provider.postedAt")}>{format.relativeTime(item.createdAt)}</Field>
          </dl>
          <p className="mt-3 text-xs text-gray-500">{t("provider.privacyNote")}</p>
        </CardBody>
      </Card>

      {item.myOffer ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p className="font-bold">
              {t("provider.offerSent")}: <Money amount={item.myOffer.totalSyp} />
            </p>
            <p className="text-sm text-gray-600">
              {t("offer.validUntil")}: {format.dateTime(item.myOffer.validUntil, { timeStyle: "short" })}
            </p>
            <ActionForm action={withdrawOfferAction}>
              <input type="hidden" name="offerId" value={item.myOffer.id} />
              <SubmitButton variant="outline">{t("provider.withdrawOffer")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : item.offersFull ? (
        <Notice tone="warning">{t("provider.offerFull")}</Notice>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t("provider.offerFormTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            {pricingNote ? <p className="mb-4 rounded-lg bg-brand-yellow-soft p-3 text-sm">{pricingNote}</p> : null}
            <ActionForm action={submitOfferAction}>
              <input type="hidden" name="requestId" value={item.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                {amountInput("calloutFeeSyp", t("offer.callout"), true)}
                {amountInput("laborSyp", t("offer.labor"))}
                {amountInput("partsSyp", t("offer.parts"))}
              </div>
              <p className="text-xs text-gray-500">{t("provider.amountsHint")}</p>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-bold">
                  {t("offer.eta")} ({t("provider.minutesUnit")}) <span className="text-brand-red">*</span>
                </span>
                <Input name="etaMinutes" inputMode="numeric" dir="ltr" required maxLength={4} className="numeric" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-bold">{t("offer.includes")}</span>
                <Input name="includesText" maxLength={500} placeholder={t("provider.includesPlaceholder")} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-bold">{t("offer.excludes")}</span>
                <Input name="excludesText" maxLength={500} placeholder={t("provider.excludesPlaceholder")} />
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="calloutDueIfDeclined" defaultChecked className="mt-1 h-5 w-5 accent-ink" />
                <span>
                  <span className="font-bold">{t("provider.calloutDueIfDeclined")}</span>
                  <span className="block text-gray-600">{t("provider.calloutDueHint")}</span>
                </span>
              </label>
              <p className="text-xs text-gray-500">{t("provider.offerRules", { minutes: settings.offerValidityMinutes })}</p>
              <SubmitButton size="lg" fullWidth>{t("provider.sendOffer")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
