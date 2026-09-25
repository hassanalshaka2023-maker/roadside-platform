import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Field, Notice } from "@/components/ui/States";
import { ProfileForm } from "@/features/providers/components/ProfileForm";
import { getOwnProfile } from "@/features/providers/service";
import { requireRole } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { governorateName } from "@/lib/geo";

export default async function ProviderProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireRole(locale, ["PROVIDER"], "customer");
  const t = await getTranslations();
  const profile = await getOwnProfile(user.id);
  if (!profile) return <Notice tone="danger">{t("provider.suspendedText")}</Notice>;

  const services = await prisma.serviceType.findMany({
    where: { id: { in: profile.serviceTypeIds } },
    select: { nameAr: true, nameEn: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("provider.profile.approved")}</CardTitle>
        </CardHeader>
        <CardBody>
          <dl>
            <Field label={t("apply.services")}>{services.map((s) => (locale === "ar" ? s.nameAr : s.nameEn)).join("، ") || "—"}</Field>
            <Field label={t("apply.governorate")}>{governorateName(profile.governorate, locale) || "—"}</Field>
            {profile.workshopName ? <Field label={t("apply.workshopName")}>{profile.workshopName}</Field> : null}
          </dl>
          <p className="mt-2 text-xs text-gray-500">{t("provider.profile.servicesNote")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("provider.profile.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          <ProfileForm
            initial={{
              serviceRadiusKm: profile.serviceRadiusKm,
              workingHours: profile.workingHours ?? "",
              coverageAreas: profile.coverageAreas,
              lat: profile.currentLat,
              lng: profile.currentLng,
            }}
            map={{
              tileUrl: env.MAP_TILE_URL,
              tileAttribution: env.MAP_TILE_ATTRIBUTION,
              defaultLat: env.MAP_DEFAULT_LAT,
              defaultLng: env.MAP_DEFAULT_LNG,
              defaultZoom: env.MAP_DEFAULT_ZOOM,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
