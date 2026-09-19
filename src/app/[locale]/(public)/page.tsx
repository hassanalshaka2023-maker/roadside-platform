import {
  BatteryCharging,
  Car,
  CircleDot,
  Fuel,
  KeyRound,
  ShieldCheck,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { loggerFor } from "@/lib/logger";

const log = loggerFor("page/home");

/** Slug -> icon. Kept here rather than in the database: icons are code. */
const SERVICE_ICONS: Record<string, LucideIcon> = {
  towing: Truck,
  battery: BatteryCharging,
  "tire-change": CircleDot,
  "fuel-delivery": Fuel,
  lockout: KeyRound,
  "on-site-mechanic": Wrench,
  "pre-purchase-inspection": ShieldCheck,
};

interface ServiceCard {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

/**
 * Loads the active services for the current locale.
 *
 * Wrapped so the marketing page still renders if the database is unreachable:
 * a homepage that loses its service grid is a bad day, one that returns a 500
 * is a lost customer.
 */
async function loadServices(locale: string): Promise<ServiceCard[]> {
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
      },
    });

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: locale === "ar" ? row.nameAr : row.nameEn,
      description: locale === "ar" ? row.descriptionAr : row.descriptionEn,
    }));
  } catch (error) {
    log.error({ err: error }, "failed to load service types for home page");
    return [];
  }
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, services] = await Promise.all([getTranslations(), loadServices(locale)]);

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Hero: the dark, high-contrast "road and rescue" look from the flyer */}
      <section className="dark-surface bg-ink text-white">
        <div className="container py-12 sm:py-20">
          <h1 className="max-w-2xl text-3xl leading-tight sm:text-5xl">
            {t("home.heroTitle")}
          </h1>
          <p className="mt-4 max-w-xl text-base text-gray-300 sm:text-lg">
            {t("home.heroSubtitle")}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/request"
              className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-brand-yellow px-6 text-lg font-extrabold text-ink hover:bg-brand-yellow-hover"
            >
              {t("home.heroCtaRequest")}
            </Link>
            <Link
              href="/apply"
              className="inline-flex min-h-[52px] items-center justify-center rounded-lg border-2 border-white px-6 text-lg font-extrabold text-white hover:bg-white/10"
            >
              {t("home.heroCtaProvider")}
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="container py-12">
        <h2 className="text-2xl sm:text-3xl">{t("home.servicesTitle")}</h2>
        <p className="mt-2 text-gray-600">{t("home.servicesSubtitle")}</p>

        {services.length === 0 ? (
          // Empty state: every list in this app has one.
          <p className="mt-6 rounded-lg bg-gray-100 p-6 text-center text-gray-600">
            {t("common.empty")}
          </p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => {
              const Icon = SERVICE_ICONS[service.slug] ?? Car;
              return (
                <li key={service.id}>
                  <Card className="h-full">
                    <CardBody className="flex gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-ink text-brand-yellow">
                        <Icon aria-hidden="true" className="h-6 w-6" />
                      </span>
                      <span>
                        <span className="block font-extrabold">{service.name}</span>
                        {service.description ? (
                          <span className="mt-1 block text-sm text-gray-600">
                            {service.description}
                          </span>
                        ) : null}
                      </span>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="bg-gray-50 py-12">
        <div className="container">
          <h2 className="text-2xl sm:text-3xl">{t("home.howItWorksTitle")}</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {(["step1", "step2", "step3"] as const).map((step, index) => (
              <li key={step}>
                <Card className="h-full">
                  <CardBody>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-yellow font-extrabold text-ink">
                      {index + 1}
                    </span>
                    <h3 className="mt-3 text-lg">{t(`home.${step}Title`)}</h3>
                    <p className="mt-1 text-sm text-gray-600">
                      {t(`home.${step}Text`)}
                    </p>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="container py-12">
        <h2 className="text-2xl sm:text-3xl">{t("home.whyTitle")}</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["whyVetted", ShieldCheck],
              ["whyFast", Truck],
              ["whyCash", Car],
            ] as const
          ).map(([key, Icon]) => (
            <li key={key} className="flex gap-3">
              <Icon aria-hidden="true" className="h-6 w-6 shrink-0 text-brand-red" />
              <span>
                <span className="block font-extrabold">{t(`home.${key}`)}</span>
                <span className="mt-1 block text-sm text-gray-600">
                  {t(`home.${key}Text`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
