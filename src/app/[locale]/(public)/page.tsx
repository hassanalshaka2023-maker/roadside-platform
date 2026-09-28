import {
  BadgeCheck,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  Clock,
  HandCoins,
  HelpCircle,
  MapPin,
  Phone,
  ShieldCheck,
  Siren,
  type LucideIcon,
} from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { serviceIcon } from "@/features/services/icons";
import { effectiveCommission, readSetting } from "@/features/settings/platform";
import { getBusinessPhones } from "@/features/settings/queries";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { loggerFor } from "@/lib/logger";
import { normalizeSyrianPhone, toLocalFormat } from "@/lib/phone";

const log = loggerFor("page/home");

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

  const [t, services, policy, phones] = await Promise.all([
    getTranslations(),
    loadServices(locale),
    readSetting("commissionPolicy"),
    getBusinessPhones(),
  ]);
  const commission = effectiveCommission(policy);
  const joiningIsFree = !commission.enabled || commission.rateBps === 0;
  const first = phones.map((phone) => normalizeSyrianPhone(phone)).find((result) => result.ok);
  const callPhone = first?.ok ? first.phone : null;

  const stats: Array<[LucideIcon, string, string]> = [
    [Clock, t("home.stat247"), t("home.stat247Text")],
    [MapPin, t("home.statCoverage"), t("home.statCoverageText")],
    [Banknote, t("home.statCash"), t("home.statCashText")],
  ];
  const perks = ["providerPerks1", "providerPerks2", ...(joiningIsFree ? ["providerPerks3"] : [])];

  return (
    <>
      {/* Hero ---------------------------------------------------------------- */}
      <section className="dark-surface relative overflow-hidden bg-ink bg-glow text-white">
        <div className="container grid items-center gap-10 py-10 sm:py-14 lg:grid-cols-[1.1fr_1fr] lg:py-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-yellow/30 bg-brand-yellow/10 px-3 py-1 text-sm font-bold text-brand-yellow">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-red opacity-75 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-red" />
              </span>
              {t("common.hoursAllDay")}
            </p>
            <h1 className="mt-5 text-[2rem] leading-[1.25] sm:text-5xl sm:leading-[1.2]">{t("home.heroTitle")}</h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-gray-300 sm:text-lg">{t("home.heroSubtitle")}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/request"
                className="inline-flex min-h-[60px] items-center justify-center gap-2 rounded-xl bg-brand-yellow px-8 text-xl font-extrabold text-ink shadow-[0_8px_30px_rgba(255,212,0,0.25)] transition-colors hover:bg-brand-yellow-hover"
              >
                <Siren aria-hidden="true" className="h-6 w-6" />
                {t("home.heroCtaRequest")}
              </Link>
              {callPhone ? (
                <a
                  href={`tel:${callPhone}`}
                  className="inline-flex min-h-[60px] items-center justify-center gap-2 rounded-xl border-2 border-white/25 px-6 text-lg font-extrabold text-white transition-colors hover:border-white hover:bg-white/10"
                >
                  <Phone aria-hidden="true" className="h-5 w-5 text-brand-red" />
                  {t("home.callNow")}
                  <span dir="ltr" className="numeric text-base font-bold text-gray-300">
                    {toLocalFormat(callPhone)}
                  </span>
                </a>
              ) : null}
            </div>
            <p className="mt-4 text-sm text-gray-400">{t("home.heroNote")}</p>

            <ul className="mt-8 grid grid-cols-3 gap-3 border-t border-white/10 pt-6 sm:gap-6">
              {stats.map(([Icon, title, text]) => (
                <li key={title} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-brand-yellow sm:mt-0.5" />
                  <span>
                    <span className="block text-sm font-extrabold sm:text-base">{title}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-gray-400">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick start: one tap from the home page into the right request. */}
          {services && services.length > 0 ? (
            <div className="hidden rounded-2xl border border-white/10 bg-white/[0.04] p-6 lg:block">
              <h2 className="text-xl">{t("home.quickTitle")}</h2>
              <p className="mt-1 text-sm text-gray-400">{t("home.quickSubtitle")}</p>
              <ul className="mt-5 grid grid-cols-2 gap-3">
                {services.map((service) => {
                  const Icon = serviceIcon(service.slug);
                  return (
                    <li key={service.id}>
                      <Link
                        href={`/request?service=${service.slug}`}
                        className="flex min-h-[64px] items-center gap-3 rounded-xl bg-white/[0.06] p-3 font-bold transition-colors hover:bg-brand-yellow hover:text-ink"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink text-brand-yellow">
                          <Icon aria-hidden="true" className="h-5 w-5" />
                        </span>
                        {service.name}
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link
                    href="/request"
                    className="flex min-h-[64px] items-center justify-center gap-1 rounded-xl border border-dashed border-white/25 p-3 text-sm font-bold text-gray-300 transition-colors hover:border-brand-yellow hover:text-brand-yellow"
                  >
                    {t("home.allServices")}
                    <ChevronLeft aria-hidden="true" className="h-4 w-4 ltr:rotate-180" />
                  </Link>
                </li>
              </ul>
            </div>
          ) : null}
        </div>
        <div aria-hidden="true" className="h-1 w-full bg-road-line" />
      </section>

      {/* Services --------------------------------------------------------------- */}
      <section className="container py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl">{t("home.servicesTitle")}</h2>
        <p className="mt-2 text-gray-600">{t("home.servicesSubtitle")}</p>

        {services === null ? (
          <p className="mt-6 rounded-lg bg-danger-soft p-6 text-center text-danger">{t("errors.technical")}</p>
        ) : services.length === 0 ? (
          <p className="mt-6 rounded-lg bg-gray-100 p-6 text-center text-gray-600">{t("common.empty")}</p>
        ) : (
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {services.map((service) => {
              const Icon = serviceIcon(service.slug);
              return (
                <li key={service.id}>
                  <Link
                    href={`/request?service=${service.slug}`}
                    className="group flex h-full flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-ink sm:p-5"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink text-brand-yellow transition-colors group-hover:bg-brand-yellow group-hover:text-ink">
                      <Icon aria-hidden="true" className="h-6 w-6" />
                    </span>
                    <span>
                      <span className="block font-extrabold leading-snug">{service.name}</span>
                      {service.description ? (
                        <span className="mt-1 block text-xs leading-relaxed text-gray-600 sm:text-sm">
                          {service.description}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
            <li>
              <Link
                href="/request"
                className="flex h-full flex-col gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-4 transition-colors hover:border-ink sm:p-5"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-red-soft text-brand-red">
                  <HelpCircle aria-hidden="true" className="h-6 w-6" />
                </span>
                <span>
                  <span className="block font-extrabold leading-snug">{t("wizard.dontKnow")}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-gray-600 sm:text-sm">{t("wizard.dontKnowHint")}</span>
                </span>
              </Link>
            </li>
          </ul>
        )}
      </section>

      <div className="hazard-divider" />

      {/* How it works ------------------------------------------------------------ */}
      <section className="bg-gray-50 py-12 sm:py-16">
        <div className="container">
          <h2 className="text-2xl sm:text-3xl">{t("home.howItWorksTitle")}</h2>
          <ol className="mt-8 grid gap-6 lg:grid-cols-4 lg:gap-4">
            {(["step1", "step2", "step3", "step4"] as const).map((step, index, all) => (
              <li key={step} className="relative flex gap-4 lg:flex-col lg:gap-3">
                {/* The line joining the numbered dots: down on phones, across on desktop. */}
                {index < all.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute start-5 top-10 h-[calc(100%-1rem)] w-0.5 bg-gray-300 lg:start-10 lg:top-5 lg:h-0.5 lg:w-[calc(100%-1.5rem)]"
                  />
                ) : null}
                <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-yellow text-lg font-extrabold text-ink ring-4 ring-gray-50">
                  {index + 1}
                </span>
                <span>
                  <h3 className="text-lg">{t(`home.${step}Title`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{t(`home.${step}Text`)}</p>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Why -------------------------------------------------------------------- */}
      <section className="container py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl">{t("home.whyTitle")}</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["whyVetted", BadgeCheck],
              ["whyPrice", HandCoins],
              ["whyNoSurprise", ShieldCheck],
              ["whyCash", Banknote],
            ] as const
          ).map(([key, Icon]) => (
            <li key={key} className="flex gap-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5 lg:flex-col lg:gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-red-soft text-brand-red">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-extrabold">{t(`home.${key}`)}</span>
                <span className="mt-1 block text-sm leading-relaxed text-gray-600">{t(`home.${key}Text`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Join -------------------------------------------------------------------- */}
      <section className="dark-surface bg-navy text-white">
        <div className="container grid items-center gap-8 py-12 sm:py-16 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 className="text-2xl sm:text-3xl">{t("home.joinTitle")}</h2>
            <p className="mt-3 max-w-xl leading-relaxed text-gray-300">{t("home.joinText")}</p>
            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
              {perks.map((key) => (
                <li key={key} className="flex items-center gap-2 font-bold">
                  <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-brand-yellow" />
                  {t(`home.${key}`)}
                </li>
              ))}
            </ul>
          </div>
          <Link
            href="/apply"
            className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-brand-yellow px-8 text-lg font-extrabold text-ink transition-colors hover:bg-brand-yellow-hover lg:justify-self-end"
          >
            {t("home.heroCtaProvider")}
            <ChevronLeft aria-hidden="true" className="h-5 w-5 ltr:rotate-180" />
          </Link>
        </div>
      </section>
    </>
  );
}
