import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/States";
import { RequestWizard, type WizardService } from "@/features/requests/components/RequestWizard";
import { isIdRequiredFor } from "@/features/requests/service";
import { readSetting } from "@/features/settings/platform";
import { loginChannels } from "@/lib/auth/channels";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { loggerFor } from "@/lib/logger";

const log = loggerFor("page/request");

async function loadServices(locale: string): Promise<WizardService[] | null> {
  try {
    const rows = await prisma.serviceType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        slug: true,
        nameAr: true,
        nameEn: true,
        descriptionAr: true,
        descriptionEn: true,
        pricingNoteAr: true,
        pricingNoteEn: true,
        requiresDestination: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: locale === "ar" ? row.nameAr : row.nameEn,
      description: locale === "ar" ? row.descriptionAr : row.descriptionEn,
      pricingNote: locale === "ar" ? row.pricingNoteAr : row.pricingNoteEn,
      requiresDestination: row.requiresDestination,
    }));
  } catch (error) {
    log.error({ err: error }, "failed to load services for the request form");
    return null;
  }
}

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ service?: string }>;
}) {
  const { locale } = await params;
  const { service: serviceSlug } = await searchParams;
  setRequestLocale(locale);

  const [t, user, services, idMode] = await Promise.all([
    getTranslations(),
    getCurrentUser(),
    loadServices(locale),
    readSetting("customerIdMode"),
  ]);

  // The provider app is for working: "request help" belongs to customers.
  if (user?.role === "PROVIDER") redirect(`/${locale}/provider`);

  const preselected = services?.find((s) => s.slug === serviceSlug)?.id;

  return (
    <div className="container max-w-2xl py-8">
      <h1 className="text-2xl sm:text-3xl">{t("wizard.title")}</h1>
      <p className="mb-6 mt-2 text-gray-600">{t("wizard.subtitle")}</p>

      {user?.role === "ADMIN" ? (
        <Notice tone="warning">{t("wizard.adminCannotRequest")}</Notice>
      ) : services === null ? (
        // A technical failure: say so, never "no services".
        <Notice tone="danger" title={t("errors.technicalTitle")}>
          {t("errors.technical")}
        </Notice>
      ) : (
        <RequestWizard
          services={services}
          signedIn={Boolean(user)}
          idRequired={user ? await isIdRequiredFor(user.id, idMode) : false}
          channels={loginChannels()}
          needsContactPhone={Boolean(user && !user.phone && !user.contactPhone)}
          preselectedServiceId={preselected}
          map={{
            tileUrl: env.MAP_TILE_URL,
            tileAttribution: env.MAP_TILE_ATTRIBUTION,
            defaultLat: env.MAP_DEFAULT_LAT,
            defaultLng: env.MAP_DEFAULT_LNG,
            defaultZoom: env.MAP_DEFAULT_ZOOM,
          }}
        />
      )}
    </div>
  );
}
