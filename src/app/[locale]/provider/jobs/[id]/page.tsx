import { ExternalLink, Phone } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { Field, Notice } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Textarea } from "@/components/ui/Textarea";
import {
  advanceJobAction,
  markDoneAction,
  proposeExtraAction,
  providerWithdrawAction,
  reopenJobAction,
  updateEtaAction,
  withdrawExtraAction,
} from "@/features/jobs/actions";
import { getJobForProvider, listExtras } from "@/features/jobs/queries";
import { complaintAction } from "@/features/requests/actions";
import { COMPLAINT_CATEGORIES } from "@/features/feedback/service";
import { Link } from "@/i18n/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { governorateName } from "@/lib/geo";
import { toLocalFormat } from "@/lib/phone";
import { Select } from "@/components/ui/Select";

export default async function ProviderJobPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const user = await requireRole(locale, ["PROVIDER"], "customer");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

  // Filtered by assignedProviderId in the query: another provider's job id
  // is indistinguishable from a missing one.
  const job = await getJobForProvider(user.id, id);
  if (!job) notFound();
  const extras = await listExtras(job.id);

  const status = job.status;
  const onSite = status === "ARRIVED" || status === "IN_PROGRESS";
  const pendingExtra = extras.find((e) => e.status === "PENDING");
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const idField = hidden("requestId", job.id);
  const mapUrl =
    job.lat !== null && job.lng !== null
      ? `https://www.openstreetmap.org/?mlat=${job.lat}&mlon=${job.lng}#map=17/${job.lat}/${job.lng}`
      : null;

  return (
    <div className="flex flex-col gap-4">
      {status !== "COMPLETED" ? <AutoRefresh seconds={20} /> : null}
      <Link href="/provider" className="text-sm font-bold underline">
        {t("common.back")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl">{locale === "ar" ? job.serviceType.nameAr : job.serviceType.nameEn}</h2>
        <StatusBadge status={status} />
      </div>
      <p className="text-sm text-gray-600">
        <bdi className="numeric">{job.publicCode}</bdi>
      </p>

      {/* Customer and location ---------------------------------------------- */}
      <Card>
        <CardBody className="flex flex-col gap-3">
          {job.showContact && job.customer ? (
            <>
              <p className="font-extrabold">{job.customer.name || t("provider.job.customer")}</p>
              {job.customer.phone ? (
                <a
                  href={`tel:${job.customer.phone}`}
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg bg-brand-red px-5 text-lg font-extrabold text-white"
                >
                  <Phone aria-hidden="true" className="h-5 w-5" />
                  {t("provider.job.call")} <bdi dir="ltr" className="numeric">{toLocalFormat(job.customer.phone)}</bdi>
                </a>
              ) : null}
              {mapUrl ? (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-touch items-center gap-2 font-bold underline">
                  <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  {t("provider.job.openMap")}
                </a>
              ) : null}
              {job.locationApproximate ? <Notice tone="warning">{t("provider.job.approxLocation")}</Notice> : null}
            </>
          ) : (
            <p className="text-sm text-gray-600">{t("provider.job.contactHidden")}</p>
          )}
          <dl className="text-sm">
            <Field label={t("wizard.governorate")}>{governorateName(job.governorate, locale)}</Field>
            {job.landmarkText ? <Field label={t("wizard.landmark")}>{job.landmarkText}</Field> : null}
            {job.addressText ? <Field label={t("wizard.address")}>{job.addressText}</Field> : null}
            {job.destinationText ? <Field label={t("wizard.destination")}>{job.destinationText}</Field> : null}
            <Field label={t("wizard.car")}>{[job.carMake, job.carModel, job.carYear].filter(Boolean).join(" ") || "—"}</Field>
            {job.plateNumber ? <Field label={t("wizard.plate")}>{job.plateNumber}</Field> : null}
            <Field label={t("wizard.problem")}>{job.problemUnknown ? t("wizard.dontKnow") : job.problemDescription || "—"}</Field>
            {job.etaAt ? <Field label={t("offer.eta")}>{format.dateTime(job.etaAt, { timeStyle: "short" })}</Field> : null}
          </dl>
          {job.photoIds.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {job.photoIds.map((photoId) => (
                // eslint-disable-next-line @next/next/no-img-element -- private, authenticated route; next/image would proxy and cache it
                <img key={photoId} src={`/api/files/${photoId}`} alt={t("provider.job.photo")} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
              ))}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* Agreed price -------------------------------------------------------- */}
      {job.acceptedOffer ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("offer.agreedTotal")}: <Money amount={job.acceptedOffer.totalSyp} /></CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="text-sm">
              <Field label={t("offer.callout")}><Money amount={job.acceptedOffer.calloutFeeSyp} /></Field>
              <Field label={t("offer.labor")}><Money amount={job.acceptedOffer.laborSyp} /></Field>
              <Field label={t("offer.parts")}><Money amount={job.acceptedOffer.partsSyp} /></Field>
            </dl>
            <p className="mt-2 text-xs text-gray-500">{t("provider.job.priceFrozen")}</p>
          </CardBody>
        </Card>
      ) : null}

      {/* Next step ---------------------------------------------------------- */}
      {status === "CONFIRMED" ? (
        <ActionForm action={advanceJobAction}>
          {idField}
          {hidden("to", "ON_THE_WAY")}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold">{t("provider.job.etaMinutes")}</span>
            <Input name="etaMinutes" inputMode="numeric" dir="ltr" maxLength={4} className="numeric" />
          </label>
          <SubmitButton size="lg" fullWidth>{t("provider.job.onTheWay")}</SubmitButton>
        </ActionForm>
      ) : null}
      {status === "ON_THE_WAY" ? (
        <>
          <ActionForm action={advanceJobAction}>
            {idField}
            {hidden("to", "ARRIVED")}
            <SubmitButton size="lg" fullWidth>{t("provider.job.arrived")}</SubmitButton>
          </ActionForm>
          <ActionForm action={updateEtaAction} successMessage="provider.job.etaUpdated">
            {idField}
            <div className="flex gap-2">
              <Input name="etaMinutes" inputMode="numeric" dir="ltr" required maxLength={4} className="numeric" placeholder={t("provider.job.etaMinutes")} />
              <SubmitButton variant="outline">{t("provider.job.updateEta")}</SubmitButton>
            </div>
          </ActionForm>
        </>
      ) : null}
      {status === "ARRIVED" ? (
        <ActionForm action={advanceJobAction}>
          {idField}
          {hidden("to", "IN_PROGRESS")}
          <SubmitButton size="lg" fullWidth>{t("provider.job.start")}</SubmitButton>
        </ActionForm>
      ) : null}

      {/* Extras ----------------------------------------------------------------- */}
      {extras.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("extras.title")}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {extras.map((extra) => (
              <div key={extra.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3 text-sm">
                <span>
                  <span className="block font-bold">{extra.description}</span>
                  <Money amount={extra.totalSyp} /> · {t(`extras.status.${extra.status}`)}
                </span>
                {extra.status === "PENDING" ? (
                  <ActionForm action={withdrawExtraAction}>
                    {hidden("extraId", extra.id)}
                    <SubmitButton size="sm" variant="ghost">{t("provider.job.extraWithdraw")}</SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {onSite && !pendingExtra ? (
        <details className="rounded-xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer font-bold">{t("provider.job.extraTitle")}</summary>
          <ActionForm action={proposeExtraAction} className="mt-3" resetOnSuccess>
            {idField}
            <Textarea name="description" required minLength={3} maxLength={500} rows={2} placeholder={t("provider.job.extraDescription")} />
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1.5 text-sm font-bold">
                {t("offer.labor")}
                <Input name="laborSyp" inputMode="numeric" dir="ltr" className="numeric" placeholder="0" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-bold">
                {t("offer.parts")}
                <Input name="partsSyp" inputMode="numeric" dir="ltr" className="numeric" placeholder="0" />
              </label>
            </div>
            <p className="text-xs text-gray-500">{t("extras.rule")}</p>
            <SubmitButton variant="secondary">{t("provider.job.extraSend")}</SubmitButton>
          </ActionForm>
        </details>
      ) : null}
      {pendingExtra ? <Notice tone="warning">{t("provider.job.extraPending")}</Notice> : null}

      {/* Finish ------------------------------------------------------------------ */}
      {onSite && !pendingExtra ? (
        <Card className="border-2 border-ink">
          <CardBody className="flex flex-col gap-3">
            <p className="font-extrabold">{t("provider.job.doneTitle")}</p>
            <ActionForm action={markDoneAction}>
              {idField}
              <fieldset className="flex flex-col gap-2">
                <label className="flex items-start gap-3 text-sm">
                  <input type="radio" name="outcome" value="WORK_DONE" defaultChecked className="mt-1 h-5 w-5 accent-ink" />
                  {t("provider.job.doneWorkLabel")}
                </label>
                {job.acceptedOffer?.calloutDueIfDeclined ? (
                  <label className="flex items-start gap-3 text-sm">
                    <input type="radio" name="outcome" value="CALLOUT_ONLY" className="mt-1 h-5 w-5 accent-ink" />
                    {t("provider.job.doneCalloutLabel")}
                  </label>
                ) : null}
              </fieldset>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="cashReceived" required className="mt-1 h-5 w-5 accent-ink" />
                {t("provider.job.cashReceived")}
              </label>
              <p className="text-xs text-gray-500">{t("provider.job.doneHint")}</p>
              <SubmitButton size="lg" fullWidth>{t("provider.job.done")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      {status === "AWAITING_CONFIRMATION" ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p className="font-bold">{t("provider.job.awaitingCustomer")}</p>
            {job.finalAmountSyp !== null ? (
              <p>
                {t("provider.job.finalAmount")}: <Money amount={job.finalAmountSyp} className="font-extrabold" />
              </p>
            ) : null}
            <ActionForm action={reopenJobAction}>
              {idField}
              <SubmitButton variant="ghost" size="sm">{t("provider.job.reopen")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      {status === "DISPUTED" ? <Notice tone="warning">{t("provider.job.disputed")}</Notice> : null}
      {status === "COMPLETED" && job.finalAmountSyp !== null ? (
        <Notice tone="success">
          {t("provider.job.completed")} <Money amount={job.finalAmountSyp} />
        </Notice>
      ) : null}

      {/* Withdraw ------------------------------------------------------------ */}
      {["CONFIRMED", "ON_THE_WAY", "ARRIVED", "IN_PROGRESS"].includes(status) ? (
        <details className="rounded-xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer font-bold text-brand-red">{t("provider.job.withdraw")}</summary>
          <p className="mt-2 text-sm text-gray-600">{t("provider.job.withdrawHint")}</p>
          <ActionForm action={providerWithdrawAction} className="mt-3">
            {idField}
            <Input name="reason" required minLength={5} maxLength={500} placeholder={t("provider.job.withdrawReason")} />
            <SubmitButton variant="danger">{t("provider.job.withdrawConfirm")}</SubmitButton>
          </ActionForm>
        </details>
      ) : null}

      <details className="rounded-xl border border-gray-200 bg-white p-4">
        <summary className="cursor-pointer font-bold">{t("complaint.title")}</summary>
        <ActionForm action={complaintAction} className="mt-3" successMessage="complaint.sent" resetOnSuccess>
          {idField}
          <Select name="category" required defaultValue="">
            <option value="" disabled>{t("complaint.choose")}</option>
            {COMPLAINT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(`complaint.category.${c}`)}</option>
            ))}
          </Select>
          <Textarea name="description" required minLength={5} maxLength={2000} rows={3} placeholder={t("complaint.placeholder")} />
          <SubmitButton variant="outline">{t("complaint.send")}</SubmitButton>
        </ActionForm>
      </details>
    </div>
  );
}
