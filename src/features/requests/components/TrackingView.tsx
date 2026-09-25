import { CheckCircle2, Circle, Clock, Phone, Star, Truck } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { Field, Notice } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { governorateName } from "@/lib/geo";
import { COMPLAINT_CATEGORIES } from "@/features/feedback/service";
import type { OfferForCustomer } from "@/features/offers/service";
import {
  acceptOfferAction,
  cancelRequestAction,
  complaintAction,
  confirmCompletionAction,
  disputeAction,
  rateAction,
  respondExtraAction,
  restartSearchAction,
  towingFallbackAction,
} from "../actions";
import type { CustomerRequest, StatusHistoryEntry } from "../service";
import {
  customerCanCancel,
  isActiveJob,
  isTerminal,
  PROGRESS_SEQUENCE,
  progressIndex,
  SEARCH_ENDED_STATUSES,
  type RequestStatusName,
} from "../state-machine";
import { ContactNumber, contactNumberOf } from "@/components/ui/ContactNumber";

type Extra = {
  id: string;
  description: string;
  laborSyp: number;
  partsSyp: number;
  totalSyp: number;
  status: string;
  createdAt: Date;
};

export async function TrackingView({
  request,
  history,
  offers,
  extras,
  isOwner,
  cancellationPolicy,
}: {
  request: CustomerRequest;
  history: StatusHistoryEntry[];
  offers: OfferForCustomer[];
  extras: Extra[];
  isOwner: boolean;
  cancellationPolicy: string;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();
  const status = request.status as RequestStatusName;
  const serviceName = locale === "ar" ? request.serviceType.nameAr : request.serviceType.nameEn;
  const pricingNote = locale === "ar" ? request.serviceType.pricingNoteAr : request.serviceType.pricingNoteEn;
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const idField = hidden("requestId", request.id);

  return (
    <div className="flex flex-col gap-5">
      {/* Header ---------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl">{serviceName}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {t("tracking.code")}: <bdi className="numeric font-bold">{request.publicCode}</bdi>
            {" · "}
            {format.dateTime(request.createdAt, { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {!isOwner ? <Notice tone="info">{t("tracking.viewerOnly")}</Notice> : null}

      {/* Main state card ---------------------------------------------------- */}
      <Card>
        <CardBody className="flex flex-col gap-3">
          <p className="text-lg font-extrabold">{t(`tracking.headline.${status}`)}</p>
          <p className="text-gray-700">{t(`tracking.explain.${status}`)}</p>

          {status === "SEARCHING" && request.searchExpiresAt ? (
            <p className="flex items-center gap-2 text-sm text-gray-600">
              <Clock aria-hidden="true" className="h-4 w-4" />
              {t("tracking.searchUntil", { time: format.dateTime(request.searchExpiresAt, { timeStyle: "short" }) })}
            </p>
          ) : null}

          {request.etaAt && (status === "CONFIRMED" || status === "ON_THE_WAY") ? (
            <p className="flex items-center gap-2 font-bold">
              <Truck aria-hidden="true" className="h-5 w-5 text-brand-red" />
              {t("tracking.eta", { time: format.dateTime(request.etaAt, { timeStyle: "short" }) })}
            </p>
          ) : null}

          {request.cancelledReason && status.startsWith("CANCELLED") ? (
            <p className="text-sm text-gray-600">
              {t("tracking.reason")}: {request.cancelledReason}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* Offers ------------------------------------------------------------- */}
      {isOwner && status === "SEARCHING" ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("tracking.offersTitle", { count: offers.length })}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {offers.length === 0 ? (
              <p className="text-center text-gray-600">{t("tracking.noOffersYet")}</p>
            ) : (
              offers.map((offer) => {
                const profile = offer.provider.providerProfile;
                return (
                  <div key={offer.id} className="rounded-xl border-2 border-gray-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-extrabold">{profile?.workshopName || offer.provider.name}</p>
                        <p className="mt-1 flex items-center gap-1 text-sm text-gray-600">
                          {profile && profile.ratingCount > 0 ? (
                            <>
                              <Star aria-hidden="true" className="h-4 w-4 fill-brand-yellow text-brand-yellow" />
                              <bdi className="numeric font-bold">{profile.ratingAverage.toFixed(1)}</bdi>
                              {t("tracking.ratingCount", { count: profile.ratingCount })}
                            </>
                          ) : (
                            t("tracking.newProvider")
                          )}
                          {profile ? ` · ${t("tracking.jobsDone", { count: profile.completedJobs })}` : null}
                        </p>
                      </div>
                      <p className="text-xl font-extrabold">
                        <Money amount={offer.totalSyp} />
                      </p>
                    </div>

                    <dl className="mt-3 text-sm">
                      <Field label={t("offer.callout")}><Money amount={offer.calloutFeeSyp} /></Field>
                      <Field label={t("offer.labor")}><Money amount={offer.laborSyp} /></Field>
                      {offer.partsSyp > 0 ? <Field label={t("offer.parts")}><Money amount={offer.partsSyp} /></Field> : null}
                      <Field label={t("offer.eta")}>{t("offer.minutes", { count: offer.etaMinutes })}</Field>
                      <Field label={t("offer.validUntil")}>{format.dateTime(offer.validUntil, { timeStyle: "short" })}</Field>
                      {offer.includesText ? <Field label={t("offer.includes")}>{offer.includesText}</Field> : null}
                      {offer.excludesText ? <Field label={t("offer.excludes")}>{offer.excludesText}</Field> : null}
                    </dl>

                    <ActionForm action={acceptOfferAction} className="mt-3">
                      {idField}
                      {hidden("offerId", offer.id)}
                      <label className="flex items-start gap-3 rounded-lg bg-brand-yellow-soft p-3 text-sm">
                        <input type="checkbox" name="feeTermsAccepted" required className="mt-1 h-5 w-5 accent-ink" />
                        <span>
                          {offer.calloutDueIfDeclined
                            ? t("offer.feeTermsCalloutDue", { amount: offer.calloutFeeSyp.toLocaleString("en-US") })
                            : t("offer.feeTermsNoCallout")}{" "}
                          {t("offer.feeTermsExtras")}
                        </span>
                      </label>
                      <SubmitButton size="lg" fullWidth>{t("offer.accept")}</SubmitButton>
                    </ActionForm>
                  </div>
                );
              })
            )}
            {pricingNote ? <p className="text-sm text-gray-600">{pricingNote}</p> : null}
            <details className="text-sm text-gray-600">
              <summary className="cursor-pointer font-bold">{t("tracking.cancellationPolicy")}</summary>
              <p className="mt-2">{cancellationPolicy}</p>
            </details>
          </CardBody>
        </Card>
      ) : null}

      {/* Search ended ---------------------------------------------------------- */}
      {isOwner && SEARCH_ENDED_STATUSES.includes(status) ? (
        <Card>
          <CardBody className="flex flex-col gap-4">
            {!request.serviceType.requiresDestination ? (
              <>
                <Notice tone="warning" title={t("tracking.noMechanicTitle")}>
                  {t("tracking.noMechanicText")}
                </Notice>
                <ActionForm action={towingFallbackAction}>
                  {idField}
                  {hidden("locale", locale)}
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-bold">{t("wizard.destination")}</span>
                    <Input name="destinationText" required minLength={3} maxLength={300} placeholder={t("wizard.destinationHint")} />
                  </label>
                  <fieldset className="flex flex-wrap gap-4 text-sm">
                    <legend className="mb-1 font-bold">{t("wizard.canRoll")}</legend>
                    <label className="flex min-h-touch items-center gap-2">
                      <input type="radio" name="vehicleCanRoll" value="yes" className="h-5 w-5 accent-ink" />
                      {t("wizard.canRoll_yes")}
                    </label>
                    <label className="flex min-h-touch items-center gap-2">
                      <input type="radio" name="vehicleCanRoll" value="no" className="h-5 w-5 accent-ink" />
                      {t("wizard.canRoll_no")}
                    </label>
                  </fieldset>
                  <SubmitButton size="lg" fullWidth>{t("tracking.requestTowing")}</SubmitButton>
                  <p className="text-xs text-gray-500">{t("tracking.towingKeepsDetails")}</p>
                </ActionForm>
              </>
            ) : (
              <Notice tone="warning" title={t("tracking.noTowTitle")}>
                {t("tracking.noTowText")}
              </Notice>
            )}
            <ActionForm action={restartSearchAction}>
              {idField}
              <SubmitButton variant="outline" fullWidth>{t("tracking.searchAgain")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      {/* Booked provider ------------------------------------------------------- */}
      {request.assignedProvider && (isActiveJob(status) || status === "COMPLETED" || status === "DISPUTED") ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("tracking.yourProvider")}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <p className="font-extrabold">
              {request.assignedProvider.providerProfile?.workshopName || request.assignedProvider.name}
            </p>
            {request.assignedProvider.providerProfile && request.assignedProvider.providerProfile.ratingCount > 0 ? (
              <p className="flex items-center gap-1 text-sm text-gray-600">
                <Star aria-hidden="true" className="h-4 w-4 fill-brand-yellow text-brand-yellow" />
                <bdi className="numeric font-bold">{request.assignedProvider.providerProfile.ratingAverage.toFixed(1)}</bdi>
                {t("tracking.ratingCount", { count: request.assignedProvider.providerProfile.ratingCount })}
              </p>
            ) : null}
            {isOwner && isActiveJob(status) && contactNumberOf(request.assignedProvider) ? (
              <a
                href={`tel:${contactNumberOf(request.assignedProvider)!.number}`}
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg bg-brand-red px-5 text-lg font-extrabold text-white hover:bg-brand-red-dark"
              >
                <Phone aria-hidden="true" className="h-5 w-5" />
                {t("tracking.callProvider")}{" "}
                <ContactNumber user={request.assignedProvider} />
              </a>
            ) : null}

            {isOwner && request.acceptedOffer ? (
              <dl className="text-sm">
                <Field label={t("offer.agreedTotal")}><Money amount={request.acceptedOffer.totalSyp} /></Field>
                <Field label={t("offer.callout")}><Money amount={request.acceptedOffer.calloutFeeSyp} /></Field>
                <Field label={t("offer.labor")}><Money amount={request.acceptedOffer.laborSyp} /></Field>
                {request.acceptedOffer.partsSyp > 0 ? (
                  <Field label={t("offer.parts")}><Money amount={request.acceptedOffer.partsSyp} /></Field>
                ) : null}
              </dl>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* Extra charges ------------------------------------------------------- */}
      {isOwner && extras.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("extras.title")}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {extras.map((extra) => (
              <div key={extra.id} className="rounded-xl border-2 border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-bold">{extra.description}</p>
                  <p className="font-extrabold"><Money amount={extra.totalSyp} /></p>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {t("offer.labor")}: <Money amount={extra.laborSyp} /> · {t("offer.parts")}: <Money amount={extra.partsSyp} />
                </p>
                {extra.status === "PENDING" && (status === "ARRIVED" || status === "IN_PROGRESS") ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <ActionForm action={respondExtraAction}>
                      {hidden("extraId", extra.id)}
                      {hidden("decision", "approve")}
                      <SubmitButton fullWidth>{t("extras.approve")}</SubmitButton>
                    </ActionForm>
                    <ActionForm action={respondExtraAction}>
                      {hidden("extraId", extra.id)}
                      {hidden("decision", "decline")}
                      <SubmitButton variant="outline" fullWidth>{t("extras.decline")}</SubmitButton>
                    </ActionForm>
                  </div>
                ) : (
                  <p className="mt-2 text-sm font-bold">{t(`extras.status.${extra.status}`)}</p>
                )}
              </div>
            ))}
            <p className="text-xs text-gray-500">{t("extras.rule")}</p>
          </CardBody>
        </Card>
      ) : null}

      {/* Confirm completion and cash ------------------------------------------ */}
      {isOwner && status === "AWAITING_CONFIRMATION" && request.finalAmountSyp !== null ? (
        <Card className="border-2 border-brand-yellow">
          <CardBody className="flex flex-col gap-4">
            <p className="text-lg font-extrabold">{t("completion.title")}</p>
            <p>
              {t("completion.amountDue")}: <span className="text-2xl font-extrabold"><Money amount={request.finalAmountSyp} /></span>
            </p>
            <ActionForm action={confirmCompletionAction}>
              {idField}
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="paidConfirmed" required className="mt-1 h-5 w-5 accent-ink" />
                {t("completion.confirmPaid", { amount: request.finalAmountSyp.toLocaleString("en-US") })}
              </label>
              <SubmitButton size="lg" fullWidth>{t("completion.confirm")}</SubmitButton>
            </ActionForm>
            <details>
              <summary className="cursor-pointer font-bold text-brand-red">{t("completion.problem")}</summary>
              <ActionForm action={disputeAction} className="mt-3">
                {idField}
                <Textarea name="reason" required minLength={5} maxLength={1000} rows={3} placeholder={t("completion.problemPlaceholder")} />
                <SubmitButton variant="danger">{t("completion.sendProblem")}</SubmitButton>
              </ActionForm>
            </details>
          </CardBody>
        </Card>
      ) : null}

      {status === "DISPUTED" ? <Notice tone="warning">{t("tracking.disputeUnderReview")}</Notice> : null}

      {/* Rating ------------------------------------------------------------------ */}
      {isOwner && status === "COMPLETED" ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("rating.title")}</CardTitle>
          </CardHeader>
          <CardBody>
            {request.finalAmountSyp !== null ? (
              <p className="mb-3 text-sm text-gray-600">
                {t("completion.paid")}: <Money amount={request.finalAmountSyp} />
              </p>
            ) : null}
            {request.rating ? (
              <p className="flex items-center gap-1 font-bold">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star key={i} aria-hidden="true" className={`h-5 w-5 ${i < request.rating!.stars ? "fill-brand-yellow text-brand-yellow" : "text-gray-300"}`} />
                ))}
                <span className="ms-2">{t("rating.thanks")}</span>
              </p>
            ) : (
              <ActionForm action={rateAction}>
                {idField}
                <fieldset>
                  <legend className="mb-2 text-sm font-bold">{t("rating.stars")}</legend>
                  <div className="flex flex-row-reverse justify-end gap-1" dir="ltr">
                    {[5, 4, 3, 2, 1].map((n) => (
                      <label key={n} className="flex min-h-touch min-w-touch cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-gray-200 has-[:checked]:border-ink has-[:checked]:bg-brand-yellow-soft">
                        <input type="radio" name="stars" value={n} required className="sr-only" />
                        <span className="numeric font-extrabold">{n}</span>
                        <Star aria-hidden="true" className="h-4 w-4 text-brand-yellow" />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Textarea name="comment" rows={2} maxLength={500} placeholder={t("rating.commentPlaceholder")} />
                <SubmitButton>{t("rating.send")}</SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* Timeline -------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("tracking.timeline")}</CardTitle>
        </CardHeader>
        <CardBody>
          <ol className="flex flex-col gap-3">
            {PROGRESS_SEQUENCE.map((step) => {
              const reached = history.find((h) => h.toStatus === step);
              const current = progressIndex(status);
              const done = current >= 0 ? progressIndex(step) <= current : Boolean(reached);
              return (
                <li key={step} className="flex items-center gap-3">
                  {done ? (
                    <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-success" />
                  ) : (
                    <Circle aria-hidden="true" className="h-5 w-5 text-gray-300" />
                  )}
                  <span className={done ? "font-bold" : "text-gray-500"}>{t(`status.${step}`)}</span>
                  {reached ? (
                    <span className="ms-auto text-xs text-gray-500">{format.dateTime(reached.createdAt, { timeStyle: "short" })}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>

      {/* Details ------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>{t("tracking.details")}</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="text-sm">
            <Field label={t("wizard.governorate")}>
              {governorateName(request.governorate, locale)}
              {request.locationApproximate ? ` — ${t("wizard.approximate")}` : ""}
            </Field>
            {request.landmarkText ? <Field label={t("wizard.landmark")}>{request.landmarkText}</Field> : null}
            {request.destinationText ? <Field label={t("wizard.destination")}>{request.destinationText}</Field> : null}
            {request.carMake || request.carModel ? (
              <Field label={t("wizard.car")}>{[request.carMake, request.carModel, request.carYear].filter(Boolean).join(" ")}</Field>
            ) : null}
            <Field label={t("wizard.problem")}>
              {request.problemUnknown ? t("wizard.dontKnow") : request.problemDescription || "—"}
            </Field>
          </dl>
        </CardBody>
      </Card>

      {/* Cancel / complaint ------------------------------------------------------ */}
      {isOwner && customerCanCancel(status) ? (
        <details className="rounded-xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer font-bold">{t("tracking.cancel")}</summary>
          <p className="mt-2 text-sm text-gray-600">{cancellationPolicy}</p>
          <ActionForm action={cancelRequestAction} className="mt-3">
            {idField}
            <Input name="reason" maxLength={300} placeholder={t("tracking.cancelReason")} />
            <SubmitButton variant="danger">{t("tracking.confirmCancel")}</SubmitButton>
          </ActionForm>
        </details>
      ) : null}

      {isOwner && (isActiveJob(status) || isTerminal(status) || status === "DISPUTED") && request.assignedProviderId ? (
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
      ) : null}
    </div>
  );
}
