/**
 * Who is told what, and when.
 *
 * Every function here is fire-and-forget: it schedules work with
 * `notifyLater` and returns immediately. Services call these AFTER their
 * transaction has committed, so a notification never announces something
 * that was rolled back, and a push failure never touches the business result.
 */
import "server-only";

import { after } from "next/server";

import { prisma } from "@/lib/db";
import { loggerFor } from "@/lib/logger";
import { boundingBox, checkEligibility } from "@/features/matching/eligibility";
import { ACTIVE_JOB_STATUSES } from "@/features/requests/state-machine";
import { readMatchingSettings } from "@/features/settings/platform";
import type { PushEvent } from "./messages";
import { isPushEnabled, sendToUsers } from "./push";

const log = loggerFor("notifications/events");

/** Most providers one new request alerts; the nearest are chosen first. */
const MAX_PROVIDERS_PER_REQUEST = 100;

/**
 * Runs `task` after the response is sent (Next.js `after`), or right away
 * when there is no request in flight (CLI scripts such as the sweep job).
 * Errors are logged and swallowed.
 */
export function notifyLater(label: string, task: () => Promise<void>): void {
  if (!isPushEnabled()) return;

  const run = () =>
    task().catch((error: unknown) => log.error({ err: error, label }, "notification task failed"));
  try {
    after(run);
  } catch {
    void run();
  }
}

const requestSummarySelect = {
  id: true,
  publicCode: true,
  trackingToken: true,
  customerId: true,
  assignedProviderId: true,
  governorate: true,
  serviceType: { select: { nameAr: true, nameEn: true } },
} as const;

async function loadSummary(requestId: string) {
  return prisma.serviceRequest.findUnique({ where: { id: requestId }, select: requestSummarySelect });
}

async function send(userIds: readonly (string | null | undefined)[], event: PushEvent) {
  await sendToUsers(
    userIds.filter((id): id is string => Boolean(id)),
    event,
  );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * A request is (again) searching: alert the providers who could bid on it,
 * by the same eligibility rules as the provider feed. Only providers with a
 * subscribed device are even loaded. `exclude` skips someone who just
 * dropped this very job.
 */
export function notifyRequestSearching(requestId: string, exclude: readonly string[] = []): void {
  notifyLater("requestSearching", async () => {
    const request = await prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: {
        ...requestSummarySelect,
        status: true,
        lat: true,
        lng: true,
        serviceTypeId: true,
        carCategory: true,
        serviceType: { select: { nameAr: true, nameEn: true, requiresDestination: true } },
      },
    });
    if (!request || request.status !== "SEARCHING") return;

    const settings = await readMatchingSettings();
    const box = boundingBox({ lat: request.lat, lng: request.lng }, settings.searchRadiusKm);

    const profiles = await prisma.providerProfile.findMany({
      where: {
        status: "ACTIVE",
        isAvailable: true,
        serviceTypeIds: { has: request.serviceTypeId },
        currentLat: { gte: box.minLat, lte: box.maxLat },
        currentLng: { gte: box.minLng, lte: box.maxLng },
        userId: { notIn: [request.customerId, ...exclude] },
        user: { role: "PROVIDER", status: "ACTIVE", pushSubscriptions: { some: {} } },
      },
      select: {
        userId: true,
        serviceTypeIds: true,
        currentLat: true,
        currentLng: true,
        serviceRadiusKm: true,
        towCapacities: true,
        status: true,
        isAvailable: true,
      },
      take: 500,
    });
    if (profiles.length === 0) return;

    const busy = await prisma.serviceRequest.findMany({
      where: {
        assignedProviderId: { in: profiles.map((p) => p.userId) },
        status: { in: [...ACTIVE_JOB_STATUSES] },
      },
      select: { assignedProviderId: true },
    });
    const busyIds = new Set(busy.map((b) => b.assignedProviderId));

    const recipients = profiles
      .map((p) => ({
        userId: p.userId,
        eligibility: checkEligibility(
          {
            userId: p.userId,
            userStatus: "ACTIVE",
            profileStatus: p.status,
            isAvailable: p.isAvailable,
            serviceTypeIds: p.serviceTypeIds,
            lat: p.currentLat,
            lng: p.currentLng,
            serviceRadiusKm: p.serviceRadiusKm,
            towCapacities: p.towCapacities,
            hasActiveJob: busyIds.has(p.userId),
          },
          {
            customerId: request.customerId,
            serviceTypeId: request.serviceTypeId,
            lat: request.lat,
            lng: request.lng,
            requiresDestination: request.serviceType.requiresDestination,
            carCategory: request.carCategory,
          },
          { platformRadiusKm: settings.searchRadiusKm },
        ),
      }))
      .filter((r) => r.eligibility.eligible)
      .sort(
        (a, b) =>
          (a.eligibility.eligible ? a.eligibility.distanceKm : 0) -
          (b.eligibility.eligible ? b.eligibility.distanceKm : 0),
      )
      .slice(0, MAX_PROVIDERS_PER_REQUEST)
      .map((r) => r.userId);

    await send(recipients, {
      type: "newRequest",
      requestId: request.id,
      service: request.serviceType,
      governorate: request.governorate,
    });
  });
}

export function notifyProviderInvited(requestId: string, providerUserId: string): void {
  notifyLater("providerInvited", async () => {
    const r = await loadSummary(requestId);
    if (!r) return;
    await send([providerUserId], {
      type: "invited",
      requestId: r.id,
      service: r.serviceType,
      governorate: r.governorate,
    });
  });
}

export function notifyOfferAccepted(requestId: string): void {
  notifyLater("offerAccepted", async () => {
    const r = await loadSummary(requestId);
    if (!r?.assignedProviderId) return;
    await send([r.assignedProviderId], {
      type: "offerAccepted",
      requestId: r.id,
      publicCode: r.publicCode,
      service: r.serviceType,
    });
  });
}

/** `providerUserId` is passed in: by now the booking has been cleared. */
export function notifyBookingCancelled(
  requestId: string,
  providerUserId: string | null,
  by: "customer" | "admin",
): void {
  if (!providerUserId) return;
  notifyLater("bookingCancelled", async () => {
    const r = await loadSummary(requestId);
    if (!r) return;
    await send([providerUserId], { type: "bookingCancelled", requestId: r.id, publicCode: r.publicCode, by });
  });
}

export function notifyExtraAnswered(extraId: string, approved: boolean): void {
  notifyLater("extraAnswered", async () => {
    const extra = await prisma.extraCharge.findUnique({
      where: { id: extraId },
      select: { providerId: true, request: { select: { id: true, publicCode: true } } },
    });
    if (!extra) return;
    await send([extra.providerId], {
      type: "extraAnswered",
      requestId: extra.request.id,
      publicCode: extra.request.publicCode,
      approved,
    });
  });
}

export function notifyCompletionAnswered(requestId: string, confirmed: boolean): void {
  notifyLater("completionAnswered", async () => {
    const r = await loadSummary(requestId);
    if (!r?.assignedProviderId) return;
    await send([r.assignedProviderId], {
      type: "completionAnswered",
      requestId: r.id,
      publicCode: r.publicCode,
      confirmed,
    });
  });
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export function notifyNewOffer(offerId: string): void {
  notifyLater("newOffer", async () => {
    const offer = await prisma.requestOffer.findUnique({
      where: { id: offerId },
      select: { totalSyp: true, etaMinutes: true, request: { select: requestSummarySelect } },
    });
    if (!offer) return;
    await send([offer.request.customerId], {
      type: "newOffer",
      trackingToken: offer.request.trackingToken,
      service: offer.request.serviceType,
      totalSyp: offer.totalSyp,
      etaMinutes: offer.etaMinutes,
    });
  });
}

/** The booked provider moved the job forward. */
export function notifyJobProgress(requestId: string, to: "ON_THE_WAY" | "ARRIVED" | "IN_PROGRESS" | "AWAITING_CONFIRMATION"): void {
  if (to === "IN_PROGRESS") return; // the customer is standing right there
  notifyLater("jobProgress", async () => {
    const r = await prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { customerId: true, trackingToken: true, etaAt: true, finalAmountSyp: true },
    });
    if (!r) return;

    if (to === "ON_THE_WAY") {
      const eta = r.etaAt ? Math.max(1, Math.round((r.etaAt.getTime() - Date.now()) / 60_000)) : null;
      await send([r.customerId], { type: "onTheWay", trackingToken: r.trackingToken, etaMinutes: eta });
    } else if (to === "ARRIVED") {
      await send([r.customerId], { type: "arrived", trackingToken: r.trackingToken });
    } else {
      await send([r.customerId], {
        type: "awaitingConfirmation",
        trackingToken: r.trackingToken,
        amountSyp: r.finalAmountSyp ?? 0,
      });
    }
  });
}

export function notifyExtraProposed(extraId: string): void {
  notifyLater("extraProposed", async () => {
    const extra = await prisma.extraCharge.findUnique({
      where: { id: extraId },
      select: { totalSyp: true, request: { select: { customerId: true, trackingToken: true } } },
    });
    if (!extra) return;
    await send([extra.request.customerId], {
      type: "extraProposed",
      trackingToken: extra.request.trackingToken,
      totalSyp: extra.totalSyp,
    });
  });
}

export function notifyProviderWithdrew(requestId: string, searchingAgain: boolean): void {
  notifyLater("providerWithdrew", async () => {
    const r = await loadSummary(requestId);
    if (!r) return;
    await send([r.customerId], { type: "providerWithdrew", trackingToken: r.trackingToken, searchingAgain });
  });
}

export function notifySearchEnded(requestId: string, anyOffers: boolean): void {
  notifyLater("searchEnded", async () => {
    const r = await loadSummary(requestId);
    if (!r) return;
    await send([r.customerId], { type: "searchEnded", trackingToken: r.trackingToken, anyOffers });
  });
}
