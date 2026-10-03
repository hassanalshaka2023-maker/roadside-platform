/**
 * Database side of matching: loading a provider as a candidate, and building
 * a provider's feed of open requests.
 */
import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { approximateDistanceKm, distanceKm } from "@/lib/geo";
import { readMatchingSettings } from "@/features/settings/platform";
import { ACTIVE_JOB_STATUSES } from "@/features/requests/state-machine";
import { boundingBox, checkEligibility, type ProviderCandidate } from "./eligibility";

type Db = Prisma.TransactionClient | typeof prisma;

export async function loadCandidate(db: Db, userId: string): Promise<ProviderCandidate | null> {
  const profile = await db.providerProfile.findUnique({
    where: { userId },
    select: {
      status: true,
      isAvailable: true,
      serviceTypeIds: true,
      currentLat: true,
      currentLng: true,
      serviceRadiusKm: true,
      towCapacities: true,
      user: { select: { status: true, role: true } },
    },
  });
  if (!profile || profile.user.role !== "PROVIDER") return null;

  const activeJobs = await db.serviceRequest.count({
    where: { assignedProviderId: userId, status: { in: [...ACTIVE_JOB_STATUSES] } },
  });

  return {
    userId,
    userStatus: profile.user.status,
    profileStatus: profile.status,
    isAvailable: profile.isAvailable,
    serviceTypeIds: profile.serviceTypeIds,
    lat: profile.currentLat,
    lng: profile.currentLng,
    serviceRadiusKm: profile.serviceRadiusKm,
    towCapacities: profile.towCapacities,
    hasActiveJob: activeJobs > 0,
  };
}

/**
 * Open requests this provider may bid on, nearest first.
 *
 * Shows the AREA (governorate) and an APPROXIMATE distance only. The exact
 * pin, photos, plate and the customer's name and phone stay hidden until this
 * provider is booked. What the customer wrote about the area (neighbourhood,
 * nearest landmark) and the towing destination ARE shown: a provider cannot
 * price a job without them, and the wizard tells the customer so.
 */
export async function listOpenRequestsForProvider(userId: string) {
  const candidate = await loadCandidate(prisma, userId);
  if (!candidate) return { candidate: null, items: [] as FeedItem[] };

  const settings = await readMatchingSettings();
  const now = new Date();

  const invites = await prisma.requestInvite.findMany({
    where: { providerId: userId, request: { status: "SEARCHING" } },
    select: { requestId: true },
  });
  const invitedIds = new Set(invites.map((i) => i.requestId));

  const radius = Math.min(candidate.serviceRadiusKm, settings.searchRadiusKm);
  const box =
    candidate.lat !== null && candidate.lng !== null
      ? boundingBox({ lat: candidate.lat, lng: candidate.lng }, radius)
      : null;

  const rows = await prisma.serviceRequest.findMany({
    where: {
      status: "SEARCHING",
      customerId: { not: userId },
      serviceTypeId: { in: [...candidate.serviceTypeIds] },
      OR: [
        { id: { in: [...invitedIds] } },
        ...(box
          ? [
              {
                searchExpiresAt: { gt: now },
                lat: { gte: box.minLat, lte: box.maxLat },
                lng: { gte: box.minLng, lte: box.maxLng },
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      publicCode: true,
      lat: true,
      lng: true,
      governorate: true,
      addressText: true,
      landmarkText: true,
      destinationText: true,
      carMake: true,
      carModel: true,
      carYear: true,
      carCategory: true,
      vehicleCanRoll: true,
      problemDescription: true,
      problemUnknown: true,
      destinationLat: true,
      destinationLng: true,
      searchExpiresAt: true,
      createdAt: true,
      customerId: true,
      serviceTypeId: true,
      serviceType: {
        select: { nameAr: true, nameEn: true, slug: true, requiresDestination: true },
      },
      offers: {
        where: { status: "PENDING" },
        select: { providerId: true, id: true, totalSyp: true, validUntil: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const items: FeedItem[] = [];
  for (const row of rows) {
    const invited = invitedIds.has(row.id);
    const eligibility = checkEligibility(
      candidate,
      {
        customerId: row.customerId,
        serviceTypeId: row.serviceTypeId,
        lat: row.lat,
        lng: row.lng,
        requiresDestination: row.serviceType.requiresDestination,
        carCategory: row.carCategory,
      },
      { platformRadiusKm: settings.searchRadiusKm, invited },
    );
    if (!eligibility.eligible) continue;

    const mine = row.offers.find((offer) => offer.providerId === userId) ?? null;
    const towDistanceKm =
      row.destinationLat !== null && row.destinationLng !== null
        ? Math.round(
            distanceKm(
              { lat: row.lat, lng: row.lng },
              { lat: row.destinationLat, lng: row.destinationLng },
            ),
          )
        : null;

    items.push({
      id: row.id,
      publicCode: row.publicCode,
      governorate: row.governorate,
      areaText: row.addressText || null,
      landmark: row.landmarkText || null,
      destinationText: row.destinationText || null,
      approxDistanceKm:
        candidate.lat !== null && candidate.lng !== null
          ? approximateDistanceKm({ lat: candidate.lat, lng: candidate.lng }, row)
          : null,
      towDistanceKm,
      serviceType: row.serviceType,
      carMake: row.carMake,
      carModel: row.carModel,
      carYear: row.carYear,
      carCategory: row.carCategory,
      vehicleCanRoll: row.vehicleCanRoll,
      problemDescription: row.problemDescription,
      problemUnknown: row.problemUnknown,
      searchExpiresAt: row.searchExpiresAt,
      createdAt: row.createdAt,
      invited,
      offerCount: row.offers.length,
      myOffer: mine ? { id: mine.id, totalSyp: mine.totalSyp, validUntil: mine.validUntil } : null,
      offersFull: !mine && row.offers.length >= settings.maxOffersPerRequest,
    });
  }

  items.sort((a, b) => (a.approxDistanceKm ?? 0) - (b.approxDistanceKm ?? 0));
  return { candidate, items };
}

export interface FeedItem {
  id: string;
  publicCode: string;
  governorate: string | null;
  /** Neighbourhood as the customer typed it (ServiceRequest.addressText). */
  areaText: string | null;
  landmark: string | null;
  /** Where the car goes (towing). */
  destinationText: string | null;
  approxDistanceKm: number | null;
  towDistanceKm: number | null;
  serviceType: { nameAr: string; nameEn: string; slug: string; requiresDestination: boolean };
  carMake: string | null;
  carModel: string | null;
  carYear: number | null;
  carCategory: string | null;
  vehicleCanRoll: boolean | null;
  problemDescription: string | null;
  problemUnknown: boolean;
  searchExpiresAt: Date | null;
  createdAt: Date;
  invited: boolean;
  offerCount: number;
  myOffer: { id: string; totalSyp: number; validUntil: Date } | null;
  offersFull: boolean;
}
