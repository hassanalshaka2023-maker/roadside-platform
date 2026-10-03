import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, setRequestLocale } from "next-intl/server";

import { NotificationToggle } from "@/components/pwa/NotificationToggle";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { listExtras } from "@/features/jobs/queries";
import { listOffersForRequest } from "@/features/offers/service";
import { TrackingView } from "@/features/requests/components/TrackingView";
import { vapidPublicKey } from "@/features/notifications/push";
import { isValidTrackingToken } from "@/features/requests/schemas";
import { getByTrackingToken, getStatusHistory, sweepQuietly } from "@/features/requests/service";
import { isTerminal, type RequestStatusName } from "@/features/requests/state-machine";
import { noOfferHelpDue } from "@/features/requests/no-offer-help";
import { readSetting } from "@/features/settings/platform";
import { isWhatsappEnabled } from "@/features/settings/queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { normalizeSyrianPhone, toLocalFormat } from "@/lib/phone";

/** A tracking URL is a secret: keep it out of search engines. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The customer's request page, reachable by its unguessable token.
 *
 * Anyone with the link sees the status (so a family member can follow).
 * Offers, the provider's phone, and every action are for the signed-in owner
 * only - and every action checks ownership again on the server.
 */
export default async function TrackPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  if (!isValidTrackingToken(token)) notFound();

  await sweepQuietly();
  const request = await getByTrackingToken(token);
  if (!request) notFound();

  const viewer = await getCurrentUser();
  const isOwner = viewer?.id === request.customerId;
  const status = request.status as RequestStatusName;

  const [history, offers, extras, policy, hotline, helpMinutes, whatsapp] = await Promise.all([
    getStatusHistory(request.id),
    isOwner && status === "SEARCHING" ? listOffersForRequest(request.id) : Promise.resolve([]),
    isOwner ? listExtras(request.id) : Promise.resolve([]),
    readSetting("cancellationPolicy"),
    readSetting("hotlinePhone"),
    readSetting("noOfferHelpMinutes"),
    isWhatsappEnabled(),
  ]);

  // No offer after a few minutes: give the customer a person to call. The
  // page refreshes itself every 20 s, so the card appears on its own.
  const hotlineNumber = normalizeSyrianPhone(hotline);
  const noOfferHelp =
    isOwner &&
    hotlineNumber.ok &&
    noOfferHelpDue({
      status,
      offerCount: offers.length,
      searchStartedAt: request.searchStartedAt,
      createdAt: request.createdAt,
      minutes: helpMinutes,
    })
      ? { e164: hotlineNumber.phone, display: toLocalFormat(hotlineNumber.phone), whatsapp }
      : null;

  const currentLocale = await getLocale();

  return (
    <div className="container max-w-2xl py-8">
      {!isTerminal(status) ? <AutoRefresh seconds={20} /> : null}
      {isOwner && !isTerminal(status) ? (
        <NotificationToggle publicKey={vapidPublicKey()} audience="customer" className="mb-4" />
      ) : null}
      <TrackingView
        request={request}
        history={history}
        offers={offers}
        extras={extras}
        isOwner={isOwner}
        cancellationPolicy={currentLocale === "ar" ? policy.ar : policy.en}
        noOfferHelp={noOfferHelp}
      />
    </div>
  );
}
