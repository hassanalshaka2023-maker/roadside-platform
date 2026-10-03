import { MapPin, Star } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { EmptyState, ErrorState, Notice } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { setAvailabilityAction, withdrawOfferAction } from "@/features/jobs/actions";
import { listMyPendingOffers, listProviderJobs } from "@/features/jobs/queries";
import { listOpenRequestsForProvider, type FeedItem } from "@/features/matching/queries";
import { CommissionNotice } from "@/features/providers/components/CommissionNotice";
import { getOwnProfile } from "@/features/providers/service";
import { sweepQuietly } from "@/features/requests/service";
import { Link } from "@/i18n/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { governorateName } from "@/lib/geo";
import { loggerFor } from "@/lib/logger";

const log = loggerFor("page/provider");

export default async function ProviderDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireRole(locale, ["PROVIDER"], "customer");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

  await sweepQuietly();
  const profile = await getOwnProfile(user.id);

  let feed: FeedItem[] | null = null;
  let activeJobs: Awaited<ReturnType<typeof listProviderJobs>> = [];
  let myOffers: Awaited<ReturnType<typeof listMyPendingOffers>> = [];
  try {
    [feed, activeJobs, myOffers] = await Promise.all([
      listOpenRequestsForProvider(user.id).then((r) => r.items),
      listProviderJobs(user.id, "active"),
      listMyPendingOffers(user.id),
    ]);
  } catch (error) {
    log.error({ err: error }, "failed to load provider dashboard");
  }

  const suspended = !profile || profile.status !== "ACTIVE";

  return (
    <div className="flex flex-col gap-4">
      {/* Poll only while something can change for this provider: an unavailable
          provider with nothing pending costs nothing while the page is open. */}
      {profile?.isAvailable || activeJobs.length > 0 || myOffers.length > 0 ? <AutoRefresh seconds={30} /> : null}
      <p className="text-lg font-extrabold">{t("provider.welcome", { name: user.name ?? "" })}</p>

      {suspended ? (
        <Notice tone="danger" title={t("provider.suspendedTitle")}>
          {t("provider.suspendedText")}
        </Notice>
      ) : null}

      {/* Availability ----------------------------------------------------- */}
      {profile && !suspended ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold">{t("provider.availability")}</span>
              <Badge tone={profile.isAvailable ? "success" : "neutral"}>
                {profile.isAvailable ? t("provider.available") : t("provider.unavailable")}
              </Badge>
            </div>
            {profile.currentLat === null ? <Notice tone="warning">{t("provider.noLocation")}</Notice> : null}
            <ActionForm action={setAvailabilityAction}>
              <input type="hidden" name="available" value={profile.isAvailable ? "false" : "true"} />
              <SubmitButton size="lg" fullWidth variant={profile.isAvailable ? "outline" : "primary"}>
                {profile.isAvailable ? t("provider.goOffline") : t("provider.goOnline")}
              </SubmitButton>
            </ActionForm>
            <p className="text-xs text-gray-500">{t("provider.availableHint")}</p>
            {profile.ratingCount > 0 ? (
              <p className="flex items-center gap-1 text-sm text-gray-600">
                <Star aria-hidden="true" className="h-4 w-4 fill-brand-yellow text-brand-yellow" />
                <bdi className="numeric font-bold">{profile.ratingAverage.toFixed(1)}</bdi>
                {t("tracking.ratingCount", { count: profile.ratingCount })}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <CommissionNotice />

      {feed === null ? <ErrorState title={t("errors.technicalTitle")} text={t("errors.technical")} /> : null}

      {/* Active jobs -------------------------------------------------------- */}
      {activeJobs.length > 0 ? (
        <Card className="border-2 border-brand-yellow">
          <CardHeader>
            <CardTitle>{t("provider.activeJob")}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {activeJobs.map((job) => (
              <Link key={job.id} href={`/provider/jobs/${job.id}`} className="flex min-h-touch items-center justify-between gap-3 rounded-lg bg-brand-yellow-soft p-3">
                <span>
                  <span className="block font-extrabold">{locale === "ar" ? job.serviceType.nameAr : job.serviceType.nameEn}</span>
                  <span className="block text-xs text-gray-600">
                    <bdi className="numeric">{job.publicCode}</bdi> · {governorateName(job.governorate, locale)}
                  </span>
                </span>
                <StatusBadge status={job.status} />
              </Link>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {/* My pending offers --------------------------------------------------- */}
      {myOffers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("provider.myOffers")}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {myOffers.map((offer) => (
              <div key={offer.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3">
                <span>
                  <span className="block font-bold">
                    {locale === "ar" ? offer.request.serviceType.nameAr : offer.request.serviceType.nameEn} ·{" "}
                    <Money amount={offer.totalSyp} />
                  </span>
                  <span className="block text-xs text-gray-600">
                    {t("offer.validUntil")}: {format.dateTime(offer.validUntil, { timeStyle: "short" })}
                  </span>
                </span>
                <ActionForm action={withdrawOfferAction}>
                  <input type="hidden" name="offerId" value={offer.id} />
                  <SubmitButton size="sm" variant="ghost">{t("provider.withdrawOffer")}</SubmitButton>
                </ActionForm>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {/* Feed --------------------------------------------------------------- */}
      {feed !== null && !suspended ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("provider.feedTitle")}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {feed.length === 0 ? (
              <EmptyState
                title={t("provider.feedEmpty")}
                text={profile?.isAvailable ? t("provider.feedEmptyHint") : t("provider.feedOffline")}
              />
            ) : (
              feed.map((item) => (
                <Link key={item.id} href={`/provider/requests/${item.id}`} className="block rounded-xl border-2 border-gray-200 p-4 hover:border-ink">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-extrabold">{locale === "ar" ? item.serviceType.nameAr : item.serviceType.nameEn}</span>
                    <span className="flex gap-1">
                      {item.invited ? <Badge tone="yellow">{t("provider.invited")}</Badge> : null}
                      {item.myOffer ? <Badge tone="success">{t("provider.offerSent")}</Badge> : null}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-sm text-gray-600">
                    <MapPin aria-hidden="true" className="h-4 w-4" />
                    {governorateName(item.governorate, locale)}
                    {item.areaText ? ` - ${item.areaText}` : ""}
                    {item.approxDistanceKm !== null ? ` · ${t("provider.distance", { km: item.approxDistanceKm })}` : ""}
                    {item.towDistanceKm !== null ? ` · ${t("provider.towDistance", { km: item.towDistanceKm })}` : ""}
                  </p>
                  {item.destinationText ? (
                    <p className="mt-1 text-sm font-bold">{t("provider.destinationShort", { place: item.destinationText })}</p>
                  ) : null}
                  <p className="mt-1 text-sm">
                    {[item.carMake, item.carModel, item.carYear].filter(Boolean).join(" ")}
                    {item.problemUnknown ? ` — ${t("wizard.dontKnow")}` : item.problemDescription ? ` — ${item.problemDescription.slice(0, 80)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {format.relativeTime(item.createdAt)} · {t("provider.offersCount", { count: item.offerCount })}
                  </p>
                </Link>
              ))
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
