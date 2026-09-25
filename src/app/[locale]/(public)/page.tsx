import {
  BadgeCheck,
  BatteryCharging,
  Banknote,
  Car,
  CircleDot,
  Fuel,
  HandCoins,
  KeyRound,
  ShieldCheck,
  Siren,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";
import { effectiveCommission, readSetting } from "@/features/settings/platform";
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
 * Active services for the current locale. Returns null on a database error,
 * so the page can say "could not load" instead of "no services".
 */
async function loadServices(locale: string): Promise<ServiceCard[] | null> {
  try {
    const rows = await prisma.serviceType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, slug: true, nameAr: true, nameEn: true, descriptionAr: true, descriptionEn: true },
    });
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: locale === "ar" ? row.nameAr : row.nameEn,
      description: locale === "ar" ? row.descriptionAr : row.descriptionEn,
    }));
  } catch (error) {
    log.error({ err: error }, "failed to load service types for home page");
    return null;
  }
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, services, policy] = await Promise.all([
    getTranslations(),
    loadServices(locale),
    readSetting("commissionPolicy"),
  ]);
  const commission = effectiveCommission(policy);
  const joiningIsFree = !commission.enabled || commission.rateBps === 0;

  return (
    <>
      {/* Hero ---------------------------------------------------------------- */}
      <section className="dark-surface bg-ink text-white">
        <div className="container py-10 sm:py-16">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-bold text-brand-yellow">
            <Siren aria-hidden="true" className="h-4 w-4" />
            {t("brand.tagline")}
          </p>
          <h1 className="mt-4 max-w-2xl text-3xl leading-tight sm:text-5xl">{t("home.heroTitle")}</h1>
          <p className="mt-4 max-w-xl text-base text-gray-300 sm:text-lg">{t("home.heroSubtitle")}</p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/request"
              className="inline-flex min-h-[60px] items-center justify-center gap-2 rounded-xl bg-brand-yellow px-8 text-xl font-extrabold text-ink shadow-card hover:bg-brand-yellow-hover"
            >
              <Siren aria-hidden="true" className="h-6 w-6" />
              {t("home.heroCtaRequest")}
            </Link>
            <Link
              href="/apply"
              className="inline-flex min-h-[52px] items-center justify-center rounded-xl border-2 border-white px-6 text-lg font-extrabold text-white hover:bg-white/10"
            >
              {t("home.heroCtaProvider")}
            </Link>
          </div>
          <p className="mt-4 text-sm text-gray-400">{t("home.heroNote")}</p>
        </div>
      </section>

      {/* Services --------------------------------------------------------------- */}
      <section className="container py-12">
        <h2 className="text-2xl sm:text-3xl">{t("home.servicesTitle")}</h2>
        <p className="mt-2 text-gray-600">{t("home.servicesSubtitle")}</p>

        {services === null ? (
          <p className="mt-6 rounded-lg bg-danger-soft p-6 text-center text-danger">{t("errors.technical")}</p>
        ) : services.length === 0 ? (
          <p className="mt-6 rounded-lg bg-gray-100 p-6 text-center text-gray-600">{t("common.empty")}</p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => {
              const Icon = SERVICE_ICONS[service.slug] ?? Car;
              return (
                <li key={service.id}>
                  <Link href={`/request?service=${service.slug}`} className="block h-full">
                    <Card className="h-full transition-colors hover:border-ink">
                      <CardBody className="flex gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-ink text-brand-yellow">
                          <Icon aria-hidden="true" className="h-6 w-6" />
                        </span>
                        <span>
                          <span className="block font-extrabold">{service.name}</span>
                          {service.description ? <span className="mt-1 block text-sm text-gray-600">{service.description}</span> : null}
                        </span>
                      </CardBody>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="hazard-divider" />

      {/* How it works ------------------------------------------------------------ */}
      <section className="bg-gray-50 py-12">
        <div className="container">
          <h2 className="text-2xl sm:text-3xl">{t("home.howItWorksTitle")}</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["step1", "step2", "step3", "step4"] as const).map((step, index) => (
              <li key={step}>
                <Card className="h-full">
                  <CardBody>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-yellow font-extrabold text-ink">
                      {index + 1}
                    </span>
                    <h3 className="mt-3 text-lg">{t(`home.${step}Title`)}</h3>
                    <p className="mt-1 text-sm text-gray-600">{t(`home.${step}Text`)}</p>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Why -------------------------------------------------------------------- */}
      <section className="container py-12">
        <h2 className="text-2xl sm:text-3xl">{t("home.whyTitle")}</h2>
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["whyVetted", BadgeCheck],
              ["whyPrice", HandCoins],
              ["whyNoSurprise", ShieldCheck],
              ["whyCash", Banknote],
            ] as const
          ).map(([key, Icon]) => (
            <li key={key} className="flex gap-3">
              <Icon aria-hidden="true" className="h-6 w-6 shrink-0 text-brand-red" />
              <span>
                <span className="block font-extrabold">{t(`home.${key}`)}</span>
                <span className="mt-1 block text-sm text-gray-600">{t(`home.${key}Text`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Join -------------------------------------------------------------------- */}
      <section className="dark-surface bg-navy text-white">
        <div className="container flex flex-col items-start gap-4 py-12 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl">{t("home.joinTitle")}</h2>
            <p className="mt-2 max-w-xl text-gray-300">
              {t("home.joinText")} {joiningIsFree ? t("home.joinFree") : null}
            </p>
          </div>
          <Link
            href="/apply"
            className="inline-flex min-h-[52px] shrink-0 items-center justify-center rounded-xl bg-brand-yellow px-6 text-lg font-extrabold text-ink hover:bg-brand-yellow-hover"
          >
            {t("home.heroCtaProvider")}
          </Link>
        </div>
      </section>
    </>
  );
}
