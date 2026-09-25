import { redirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { Notice } from "@/components/ui/States";
import { ApplicationStatusBadge } from "@/components/ui/StatusBadge";
import { ApplicationForm } from "@/features/applications/components/ApplicationForm";
import { applicantCanEdit, type ApplicationStatusName } from "@/features/applications/schemas";
import { getOwnApplication } from "@/features/applications/service";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Provider application. Sign-in first (the phone number is verified by OTP),
 * then one form that can be saved as a draft and submitted when complete.
 * Submitting is not approval: the page says so, and nothing changes for the
 * applicant until an admin decides.
 */
export default async function ApplyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, format, user] = await Promise.all([getTranslations(), getFormatter(), getCurrentUser()]);

  if (!user) {
    return (
      <div className="container max-w-2xl py-10">
        <h1 className="text-2xl sm:text-3xl">{t("apply.title")}</h1>
        <p className="mt-2 text-gray-600">{t("apply.subtitle")}</p>
        <Card className="mt-6">
          <CardBody className="flex flex-col gap-4">
            <p>{t("apply.loginFirst")}</p>
            <Link
              href="/login?next=/apply"
              className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-brand-yellow px-6 text-lg font-extrabold text-ink"
            >
              {t("apply.loginButton")}
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (user.role === "ADMIN") {
    return (
      <div className="container max-w-2xl py-10">
        <Notice tone="warning">{t("apply.adminCannotApply")}</Notice>
      </div>
    );
  }
  if (user.role === "PROVIDER") redirect(`/${locale}/provider`);

  const [application, services] = await Promise.all([
    getOwnApplication(user.id),
    prisma.serviceType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { slug: true, nameAr: true, nameEn: true },
    }),
  ]);

  const status = (application?.status ?? null) as ApplicationStatusName | null;
  const editable = applicantCanEdit(status);

  return (
    <div className="container max-w-2xl py-10">
      <h1 className="text-2xl sm:text-3xl">{t("apply.title")}</h1>
      <p className="mb-6 mt-2 text-gray-600">{t("apply.subtitle")}</p>

      {application ? (
        <Card className="mb-6">
          <CardBody className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">
                {t("apply.reference")}: <bdi className="numeric">{application.publicReference}</bdi>
              </p>
              <ApplicationStatusBadge status={application.status} />
            </div>
            <p className="text-sm text-gray-700">{t(`apply.statusText.${application.status}`)}</p>
            {application.submittedAt ? (
              <p className="text-xs text-gray-500">
                {t("apply.submittedAt")}: {format.dateTime(application.submittedAt, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            ) : null}
            {application.decisionReason && (status === "NEEDS_INFO" || status === "REJECTED" || status === "SUSPENDED") ? (
              <Notice tone={status === "NEEDS_INFO" ? "warning" : "danger"} title={t("apply.decisionReason")}>
                {application.decisionReason}
              </Notice>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {editable ? (
        <ApplicationForm
          needsContactPhone={!user.phone && !user.contactPhone}
          services={services.map((s) => ({ slug: s.slug, name: locale === "ar" ? s.nameAr : s.nameEn }))}
          map={{
            tileUrl: env.MAP_TILE_URL,
            tileAttribution: env.MAP_TILE_ATTRIBUTION,
            defaultLat: env.MAP_DEFAULT_LAT,
            defaultLng: env.MAP_DEFAULT_LNG,
            defaultZoom: env.MAP_DEFAULT_ZOOM,
          }}
          initial={
            application
              ? {
                  ...application,
                  specialties: application.specialties as never,
                  yearsOfExperience: application.yearsOfExperience ?? undefined,
                  workshopName: application.workshopName ?? "",
                  workshopAddress: application.workshopAddress ?? "",
                  equipmentDescription: application.equipmentDescription ?? "",
                  baseLat: application.baseLat ?? undefined,
                  baseLng: application.baseLng ?? undefined,
                  availabilityNotes: application.availabilityNotes ?? "",
                  towVehicleType: application.towVehicleType ?? "",
                  towVehiclePlate: application.towVehiclePlate ?? "",
                  vehicleDocumentId: application.vehicleDocumentId ?? undefined,
                  idDocumentFrontId: application.idDocumentFrontId ?? undefined,
                  idDocumentBackId: application.idDocumentBackId ?? undefined,
                  selfieId: application.selfieId ?? undefined,
                }
              : { fullName: user.name ?? "" }
          }
        />
      ) : null}
    </div>
  );
}
