import { ExternalLink, ShieldAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Field, Notice } from "@/components/ui/States";
import { ApplicationStatusBadge } from "@/components/ui/StatusBadge";
import { Textarea } from "@/components/ui/Textarea";
import { getApplicationAdmin } from "@/features/admin/queries";
import { decideApplicationAction } from "@/features/applications/actions";
import { allowedDecisions, type ApplicationStatusName } from "@/features/applications/schemas";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { governorateName } from "@/lib/geo";
import { toLocalFormat } from "@/lib/phone";
import { prisma } from "@/lib/db";

export default async function AdminApplicationPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const user = await requirePermission(locale, "viewProviderApplications", "admin");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const app = await getApplicationAdmin(id);
  if (!app) notFound();

  const services = await prisma.serviceType.findMany({ where: { slug: { in: app.serviceTypes } }, select: { nameAr: true, nameEn: true } });
  const decisions = can(user, "reviewProviderApplications") ? allowedDecisions(app.status as ApplicationStatusName) : [];
  const canSeeDocs = can(user, "viewIdDocuments");

  // Identity documents open in a new tab through the audited file route and
  // are NEVER inlined: loading a page must not count as viewing someone's ID.
  const docLink = (fileId: string | null, label: string) =>
    fileId ? (
      canSeeDocs ? (
        <a href={`/api/files/${fileId}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-touch items-center gap-2 font-bold underline">
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
          {label}
        </a>
      ) : (
        <span className="text-gray-500">{label} — {t("admin.docRestricted")}</span>
      )
    ) : (
      <span className="text-gray-400">{label} — {t("admin.docMissing")}</span>
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/admin/applications" className="text-sm font-bold underline">{t("common.back")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">{app.fullName}</h1>
        <ApplicationStatusBadge status={app.status} />
      </div>
      <p className="text-sm text-gray-600">
        <bdi className="numeric">{app.publicReference}</bdi> · <bdi dir="ltr" className="numeric">{toLocalFormat(app.phone)}</bdi>
      </p>

      <Notice tone="info">{t("admin.verificationReminder")}</Notice>

      <Card>
        <CardHeader><CardTitle>{t("apply.sectionWork")}</CardTitle></CardHeader>
        <CardBody>
          <dl className="text-sm">
            <Field label={t("apply.providerKind")}>
              {t(`apply.kind_${app.providerKind}`)}
              {app.workshopName ? ` — ${app.workshopName}` : ""}
            </Field>
            {app.workshopAddress ? <Field label={t("apply.workshopAddress")}>{app.workshopAddress}</Field> : null}
            <Field label={t("apply.specialties")}>{app.specialties.map((s) => t(`apply.specialty.${s}`)).join("، ") || "—"}</Field>
            <Field label={t("apply.services")}>{services.map((s) => (locale === "ar" ? s.nameAr : s.nameEn)).join("، ") || "—"}</Field>
            <Field label={t("apply.yearsOfExperience")}>{app.yearsOfExperience ?? "—"}</Field>
            {app.equipmentDescription ? <Field label={t("apply.equipment")}>{app.equipmentDescription}</Field> : null}
            <Field label={t("apply.governorate")}>{governorateName(app.governorate, locale)}</Field>
            {app.coverageAreas.length > 0 ? <Field label={t("apply.coverageAreas")}>{app.coverageAreas.join("، ")}</Field> : null}
            <Field label={t("apply.availability")}>
              {t(`apply.availability_${app.availability}`)} {app.availabilityNotes ? `— ${app.availabilityNotes}` : ""}
            </Field>
            {app.baseLat !== null && app.baseLng !== null ? (
              <Field label={t("apply.baseLocation")}>
                <a href={`https://www.openstreetmap.org/?mlat=${app.baseLat}&mlon=${app.baseLng}#map=15/${app.baseLat}/${app.baseLng}`} target="_blank" rel="noopener noreferrer" className="underline">
                  {t("provider.job.openMap")}
                </a>
              </Field>
            ) : null}
          </dl>
          {app.equipmentPhotoIds.length > 0 ? (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {app.equipmentPhotoIds.map((photoId) => (
                // eslint-disable-next-line @next/next/no-img-element -- private authenticated route
                <img key={photoId} src={`/api/files/${photoId}`} alt={t("apply.equipmentPhoto")} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
              ))}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {app.serviceTypes.includes("towing") ? (
        <Card>
          <CardHeader><CardTitle>{t("apply.sectionTowing")}</CardTitle></CardHeader>
          <CardBody>
            <dl className="text-sm">
              <Field label={t("apply.towVehicleType")}>{app.towVehicleType ?? "—"}</Field>
              <Field label={t("apply.towVehiclePlate")}>{app.towVehiclePlate ?? "—"}</Field>
              <Field label={t("apply.towCapacities")}>{app.towCapacities.map((c) => t(`vehicleCategory.${c}`)).join("، ") || "—"}</Field>
            </dl>
            {app.vehiclePhotoIds.length > 0 ? (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {app.vehiclePhotoIds.map((photoId) => (
                  // eslint-disable-next-line @next/next/no-img-element -- private authenticated route
                  <img key={photoId} src={`/api/files/${photoId}`} alt={t("apply.vehiclePhoto")} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                ))}
              </div>
            ) : null}
            <div className="mt-2">{docLink(app.vehicleDocumentId, t("apply.vehicleDocument"))}</div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert aria-hidden="true" className="h-5 w-5 text-brand-red" />
            {t("apply.sectionDocuments")}
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-1 text-sm">
          <p className="text-xs text-gray-500">{t("admin.documentsAudited")}</p>
          {docLink(app.selfieId, t("apply.selfie"))}
          {docLink(app.idDocumentFrontId, t("apply.idFront"))}
          {docLink(app.idDocumentBackId, t("apply.idBack"))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("apply.sectionConsent")}</CardTitle></CardHeader>
        <CardBody className="text-sm">
          {(["consentTerms", "consentAccuracy", "consentNoHiddenFees"] as const).map((k) => (
            <p key={k}>{app[k] ? "✓" : "✗"} {t(`apply.${k}`)}</p>
          ))}
          {app.consentAcceptedAt ? <p className="mt-1 text-xs text-gray-500">{format.dateTime(app.consentAcceptedAt, { dateStyle: "short", timeStyle: "short" })}</p> : null}
        </CardBody>
      </Card>

      {decisions.length > 0 ? (
        <Card className="border-2 border-ink">
          <CardHeader><CardTitle>{t("admin.decision")}</CardTitle></CardHeader>
          <CardBody>
            <ActionForm action={decideApplicationAction}>
              <input type="hidden" name="applicationId" value={app.id} />
              <Textarea name="reason" rows={3} maxLength={1000} placeholder={t("admin.decisionReasonPlaceholder")} />
              <p className="text-xs text-gray-500">{t("admin.reasonRule")}</p>
              <div className="flex flex-wrap gap-2">
                {decisions.map((d) => (
                  <SubmitButton key={d} name="decision" value={d} variant={d === "APPROVED" ? "primary" : d === "NEEDS_INFO" ? "secondary" : "danger"}>
                    {t(`admin.decide_${d}`)}
                  </SubmitButton>
                ))}
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>{t("admin.decisionsHistory")}</CardTitle></CardHeader>
        <CardBody>
          {app.decisions.length === 0 ? (
            <p className="text-sm text-gray-600">—</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {app.decisions.map((d) => (
                <li key={d.id}>
                  <span className="text-gray-500">{format.dateTime(d.createdAt, { dateStyle: "short", timeStyle: "short" })}</span>{" "}
                  <b>{t(`applicationStatus.${d.fromStatus}`)} ← {t(`applicationStatus.${d.toStatus}`)}</b>{" "}
                  {d.admin ? `(${d.admin.name ?? d.admin.email})` : `(${t("admin.applicant")})`}
                  {d.reason ? ` — ${d.reason}` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
