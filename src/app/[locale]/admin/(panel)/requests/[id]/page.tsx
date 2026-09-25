import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { Field, Notice } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Textarea } from "@/components/ui/Textarea";
import {
  adminCancelAction,
  adminInviteAction,
  adminReassignAction,
  adminResolveAction,
  adminRestartAction,
} from "@/features/admin/actions";
import { candidateProvidersForRequest, getRequestAdmin } from "@/features/admin/queries";
import {
  isTerminal,
  SEARCH_ENDED_STATUSES,
  type RequestStatusName,
} from "@/features/requests/state-machine";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { governorateName } from "@/lib/geo";
import { bpsToPercent } from "@/lib/money";
import { toLocalFormat } from "@/lib/phone";

export default async function AdminRequestPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const user = await requirePermission(locale, "viewAllRequests", "admin");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await getRequestAdmin(id);
  if (!r) notFound();

  const status = r.status as RequestStatusName;
  const candidates =
    status === "SEARCHING" && can(user, "dispatchRequests")
      ? await candidateProvidersForRequest({ serviceTypeId: r.serviceTypeId, lat: r.lat, lng: r.lng, customerId: r.customerId })
      : [];
  const invited = new Set(r.invites.map((i) => i.providerId));
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const idField = hidden("requestId", r.id);
  const phone = (p: string | null) => (p ? <bdi dir="ltr" className="numeric">{toLocalFormat(p)}</bdi> : "—");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Link href="/admin/requests" className="text-sm font-bold underline">
        {t("common.back")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">
          <bdi className="numeric">{r.publicCode}</bdi> · {locale === "ar" ? r.serviceType.nameAr : r.serviceType.nameEn}
        </h1>
        <StatusBadge status={status} />
      </div>

      {status === "DISPUTED" && r.disputeReason ? (
        <Notice tone="danger" title={t("admin.disputeReason")}>{r.disputeReason}</Notice>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("admin.customer")}</CardTitle></CardHeader>
          <CardBody>
            <dl className="text-sm">
              <Field label={t("account.name")}>{r.customer.name ?? "—"}</Field>
              <Field label={t("account.phone")}>{phone(r.customer.phone)}</Field>
              <Field label={t("wizard.governorate")}>
                {governorateName(r.governorate, locale)}
                {r.locationApproximate ? ` — ${t("wizard.approximate")}` : ""}
              </Field>
              {r.landmarkText ? <Field label={t("wizard.landmark")}>{r.landmarkText}</Field> : null}
              {r.addressText ? <Field label={t("wizard.address")}>{r.addressText}</Field> : null}
              {r.destinationText ? <Field label={t("wizard.destination")}>{r.destinationText}</Field> : null}
              <Field label={t("wizard.car")}>{[r.carMake, r.carModel, r.carYear, r.plateNumber].filter(Boolean).join(" · ") || "—"}</Field>
              <Field label={t("wizard.problem")}>{r.problemUnknown ? t("wizard.dontKnow") : r.problemDescription || "—"}</Field>
            </dl>
            <a
              href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=16/${r.lat}/${r.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-touch items-center gap-2 text-sm font-bold underline"
            >
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
              {t("provider.job.openMap")}
            </a>
            {r.photoIds.length > 0 ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {r.photoIds.map((photoId) => (
                  // eslint-disable-next-line @next/next/no-img-element -- private authenticated route
                  <img key={photoId} src={`/api/files/${photoId}`} alt={t("provider.job.photo")} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("admin.booking")}</CardTitle></CardHeader>
          <CardBody>
            <dl className="text-sm">
              <Field label={t("admin.provider")}>
                {r.assignedProvider ? (
                  <>
                    {r.assignedProvider.name} {phone(r.assignedProvider.phone)}
                  </>
                ) : (
                  "—"
                )}
              </Field>
              {r.finalAmountSyp !== null ? <Field label={t("completion.amountDue")}><Money amount={r.finalAmountSyp} /></Field> : null}
              <Field label={t("admin.providerConfirmed")}>
                {r.providerConfirmedAt ? format.dateTime(r.providerConfirmedAt, { dateStyle: "short", timeStyle: "short" }) : "—"}
              </Field>
              <Field label={t("admin.customerConfirmed")}>
                {r.customerConfirmedAt ? format.dateTime(r.customerConfirmedAt, { dateStyle: "short", timeStyle: "short" }) : "—"}
              </Field>
              <Field label={t("admin.commissionSnapshot")}>
                {r.commissionEnabled ? `${bpsToPercent(r.commissionRateBps)}% (${t(`provider.commissionBase.${r.commissionBase ?? "TOTAL"}`)})` : t("admin.commissionFreeShort")}
                {" · "}
                <Money amount={r.commissionSyp} />
              </Field>
              {r.searchExpiresAt ? (
                <Field label={t("admin.searchUntil")}>{format.dateTime(r.searchExpiresAt, { dateStyle: "short", timeStyle: "short" })}</Field>
              ) : null}
              {r.rating ? <Field label={t("rating.title")}>{r.rating.stars} / 5 {r.rating.comment ? `— ${r.rating.comment}` : ""}</Field> : null}
              {r.cancelledReason ? <Field label={t("tracking.reason")}>{r.cancelledReason}</Field> : null}
              {r.disputeResolution ? <Field label={t("admin.resolution")}>{r.disputeResolution}</Field> : null}
            </dl>
          </CardBody>
        </Card>
      </div>

      {/* Offers ------------------------------------------------------------ */}
      <Card>
        <CardHeader><CardTitle>{t("admin.offers")}</CardTitle></CardHeader>
        <CardBody>
          {r.offers.length === 0 ? (
            <p className="text-sm text-gray-600">{t("tracking.noOffersYet")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {r.offers.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3">
                  <span>
                    <span className="font-bold">{o.provider.name}</span> {phone(o.provider.phone)}
                    <span className="block text-xs text-gray-500">
                      {t("offer.callout")} <Money amount={o.calloutFeeSyp} /> · {t("offer.labor")} <Money amount={o.laborSyp} /> · {t("offer.parts")}{" "}
                      <Money amount={o.partsSyp} /> · {t("offer.minutes", { count: o.etaMinutes })}
                      {o.viaInvite ? ` · ${t("provider.invited")}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Money amount={o.totalSyp} className="font-extrabold" />
                    <Badge tone={o.status === "ACCEPTED" ? "success" : o.status === "PENDING" ? "yellow" : "neutral"}>{t(`offerStatus.${o.status}`)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {r.extraCharges.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>{t("extras.title")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-2 text-sm">
              {r.extraCharges.map((e) => (
                <li key={e.id} className="flex justify-between gap-2">
                  <span>{e.description}</span>
                  <span>
                    <Money amount={e.totalSyp} /> · {t(`extras.status.${e.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {/* Dispatch: invite -------------------------------------------------------- */}
      {status === "SEARCHING" && can(user, "dispatchRequests") ? (
        <Card>
          <CardHeader><CardTitle>{t("admin.invite")}</CardTitle></CardHeader>
          <CardBody className="flex flex-col gap-2">
            <p className="text-sm text-gray-600">{t("admin.inviteHint")}</p>
            {candidates.length === 0 ? (
              <Notice tone="warning">{t("admin.noCandidates")}</Notice>
            ) : (
              candidates.map((c) => (
                <div key={c.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3 text-sm">
                  <span>
                    <span className="font-bold">{c.user.name}</span> {phone(c.user.phone)}
                    <span className="block text-xs text-gray-500">
                      {c.distanceKm !== null ? t("provider.distance", { km: c.distanceKm }) : t("admin.noBase")}
                      {" · "}
                      {c.isAvailable ? t("provider.available") : t("provider.unavailable")}
                      {c.busy ? ` · ${t("admin.busy")}` : ""}
                      {c.ratingCount > 0 ? ` · ★ ${c.ratingAverage.toFixed(1)} (${c.ratingCount})` : ""}
                    </span>
                  </span>
                  {invited.has(c.userId) ? (
                    <Badge tone="success">{t("admin.invited")}</Badge>
                  ) : (
                    <ActionForm action={adminInviteAction}>
                      {idField}
                      {hidden("providerUserId", c.userId)}
                      <SubmitButton size="sm" variant="secondary" disabled={c.busy}>{t("admin.inviteButton")}</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              ))
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* Admin actions ------------------------------------------------------------- */}
      {!isTerminal(status) ? (
        <Card>
          <CardHeader><CardTitle>{t("admin.actions")}</CardTitle></CardHeader>
          <CardBody className="flex flex-col gap-4">
            {(status === "AWAITING_CONFIRMATION" || status === "DISPUTED") && can(user, "resolveDisputes") ? (
              <ActionForm action={adminResolveAction}>
                {idField}
                <p className="font-bold">{t("admin.resolveTitle")}</p>
                <Textarea name="resolution" required minLength={3} maxLength={1000} rows={2} placeholder={t("admin.resolution")} />
                <label className="flex flex-col gap-1.5 text-sm font-bold">
                  {t("admin.finalAmountOverride")}
                  <Input name="finalAmountSyp" inputMode="numeric" dir="ltr" className="numeric" placeholder={r.finalAmountSyp?.toString() ?? ""} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="outcome" value="COMPLETED">{t("admin.resolveComplete")}</SubmitButton>
                  <SubmitButton name="outcome" value="CANCELLED" variant="outline">{t("admin.resolveCancel")}</SubmitButton>
                </div>
              </ActionForm>
            ) : null}

            {SEARCH_ENDED_STATUSES.includes(status) && can(user, "dispatchRequests") ? (
              <ActionForm action={adminRestartAction}>
                {idField}
                <SubmitButton variant="secondary">{t("tracking.searchAgain")}</SubmitButton>
              </ActionForm>
            ) : null}

            {["CONFIRMED", "ON_THE_WAY"].includes(status) && can(user, "dispatchRequests") ? (
              <ActionForm action={adminReassignAction}>
                {idField}
                <Input name="reason" required minLength={3} maxLength={1000} placeholder={t("admin.reassignReason")} />
                <SubmitButton variant="outline">{t("admin.reassign")}</SubmitButton>
              </ActionForm>
            ) : null}

            {can(user, "cancelAnyRequest") && status !== "DISPUTED" && status !== "AWAITING_CONFIRMATION" ? (
              <ActionForm action={adminCancelAction}>
                {idField}
                <Input name="reason" required minLength={3} maxLength={1000} placeholder={t("admin.cancelReason")} />
                <SubmitButton variant="danger">{t("admin.cancelRequest")}</SubmitButton>
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* History ------------------------------------------------------------------ */}
      <Card>
        <CardHeader><CardTitle>{t("tracking.timeline")}</CardTitle></CardHeader>
        <CardBody>
          <ol className="flex flex-col gap-2 text-sm">
            {r.statusHistory.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-2">
                <span className="text-gray-500">{format.dateTime(h.createdAt, { dateStyle: "short", timeStyle: "medium" })}</span>
                <span className="font-bold">
                  {h.fromStatus ? `${t(`status.${h.fromStatus}`)} ← ` : ""}
                  {t(`status.${h.toStatus}`)}
                </span>
                <span className="text-gray-600">
                  {h.changedBy ? `${h.changedBy.name ?? h.changedBy.email ?? ""} (${h.changedBy.role})` : t("admin.system")}
                  {h.note ? ` — ${h.note}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      {r.complaints.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>{t("admin.complaints")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-2 text-sm">
              {r.complaints.map((c) => (
                <li key={c.id}>
                  <Badge>{t(`complaint.category.${c.category}`)}</Badge> {c.description} — <b>{t(`complaintStatus.${c.status}`)}</b>
                </li>
              ))}
            </ul>
            <Link href="/admin/complaints" className="mt-2 inline-block text-sm font-bold underline">{t("admin.complaints")}</Link>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
