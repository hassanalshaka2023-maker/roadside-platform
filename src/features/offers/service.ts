/**
 * Offers: a provider prices a request, the customer picks one.
 *
 * The one guarantee that matters most lives in `acceptOffer`: a request is
 * booked by exactly one provider, and a provider is booked on at most one
 * unfinished job, no matter how many taps, retries or simultaneous clicks
 * arrive. Three layers enforce it:
 *   1. a per-provider advisory lock, serialising bookings of the same provider
 *   2. a compare-and-swap on the request (status SEARCHING, nobody assigned)
 *   3. a partial unique index: one ACCEPTED offer per request, in Postgres
 */
import "server-only";

import { Prisma } from "@prisma/client";

import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { loggerFor } from "@/lib/logger";
import { sumSyp } from "@/lib/money";
import { checkEligibility } from "@/features/matching/eligibility";
import { loadCandidate } from "@/features/matching/queries";
import { DomainError } from "@/features/requests/errors";
import { applyTransition } from "@/features/requests/transition";
import {
  effectiveCommission,
  readMatchingSettings,
  readSetting,
} from "@/features/settings/platform";
import type { OfferInput } from "./schemas";

const log = loggerFor("offers/service");

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// ---------------------------------------------------------------------------
// Provider: submit / withdraw
// ---------------------------------------------------------------------------

export async function submitOffer(params: {
  providerUserId: string;
  input: OfferInput;
  ip?: string | null;
}): Promise<{ offerId: string }> {
  const { providerUserId, input, ip } = params;
  const settings = await readMatchingSettings();
  const now = new Date();

  const totalSyp = sumSyp(input.calloutFeeSyp, input.laborSyp, input.partsSyp);

  let offerId: string;
  try {
    offerId = await prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.findUnique({
        where: { id: input.requestId },
        select: {
          id: true,
          status: true,
          customerId: true,
          serviceTypeId: true,
          lat: true,
          lng: true,
          carCategory: true,
          searchExpiresAt: true,
          serviceType: { select: { requiresDestination: true } },
        },
      });
      if (!request) throw new DomainError("NOT_FOUND");
      if (request.status !== "SEARCHING") throw new DomainError("REQUEST_NOT_OPEN");

      const invited =
        (await tx.requestInvite.count({
          where: { requestId: request.id, providerId: providerUserId },
        })) > 0;

      // An invitation keeps the window open for the invited provider.
      if (!invited && request.searchExpiresAt && request.searchExpiresAt <= now) {
        throw new DomainError("REQUEST_NOT_OPEN");
      }

      // Re-checked inside the transaction: approval, suspension, the
      // availability toggle and "already on a job" all count at this instant.
      const candidate = await loadCandidate(tx, providerUserId);
      if (!candidate) throw new DomainError("NOT_ELIGIBLE");

      const eligibility = checkEligibility(
        candidate,
        {
          customerId: request.customerId,
          serviceTypeId: request.serviceTypeId,
          lat: request.lat,
          lng: request.lng,
          requiresDestination: request.serviceType.requiresDestination,
          carCategory: request.carCategory,
        },
        { platformRadiusKm: settings.searchRadiusKm, invited },
      );
      if (!eligibility.eligible) {
        throw new DomainError(eligibility.reason === "BUSY" ? "PROVIDER_BUSY" : "NOT_ELIGIBLE");
      }

      const pending = await tx.requestOffer.count({
        where: { requestId: request.id, status: "PENDING" },
      });
      if (pending >= settings.maxOffersPerRequest) throw new DomainError("OFFER_LIMIT_REACHED");

      const offer = await tx.requestOffer.create({
        data: {
          requestId: request.id,
          providerId: providerUserId,
          calloutFeeSyp: input.calloutFeeSyp,
          laborSyp: input.laborSyp,
          partsSyp: input.partsSyp,
          totalSyp,
          etaMinutes: input.etaMinutes,
          includesText: input.includesText || null,
          excludesText: input.excludesText || null,
          calloutDueIfDeclined: input.calloutDueIfDeclined,
          validUntil: new Date(now.getTime() + settings.offerValidityMinutes * 60_000),
          viaInvite: invited,
        },
        select: { id: true },
      });
      return offer.id;
    });
  } catch (error) {
    // The partial unique index: this provider already has a live offer here.
    if (isUniqueViolation(error)) throw new DomainError("OFFER_ALREADY_SENT");
    throw error;
  }

  await audit({
    actorId: providerUserId,
    action: "offer.submitted",
    entityType: "RequestOffer",
    entityId: offerId,
    metadata: {
      requestId: input.requestId,
      calloutFeeSyp: input.calloutFeeSyp,
      laborSyp: input.laborSyp,
      partsSyp: input.partsSyp,
      totalSyp,
      etaMinutes: input.etaMinutes,
    },
    ip,
  });

  return { offerId };
}

export async function withdrawOffer(params: {
  providerUserId: string;
  offerId: string;
  ip?: string | null;
}): Promise<void> {
  const { providerUserId, offerId, ip } = params;

  const updated = await prisma.requestOffer.updateMany({
    where: { id: offerId, providerId: providerUserId, status: "PENDING" },
    data: { status: "WITHDRAWN", respondedAt: new Date() },
  });
  if (updated.count === 0) throw new DomainError("OFFER_NOT_AVAILABLE");

  await audit({
    actorId: providerUserId,
    action: "offer.withdrawn",
    entityType: "RequestOffer",
    entityId: offerId,
    ip,
  });
}

// ---------------------------------------------------------------------------
// Customer: see and accept
// ---------------------------------------------------------------------------

/**
 * The offers a customer can choose from, with each provider's REAL rating:
 * the average and count come from submitted ratings only, and a provider
 * with none shows as "new", never as five stars.
 */
export async function listOffersForRequest(requestId: string) {
  const now = new Date();
  return prisma.requestOffer.findMany({
    where: { requestId, status: "PENDING", validUntil: { gt: now } },
    select: {
      id: true,
      calloutFeeSyp: true,
      laborSyp: true,
      partsSyp: true,
      totalSyp: true,
      etaMinutes: true,
      includesText: true,
      excludesText: true,
      calloutDueIfDeclined: true,
      validUntil: true,
      createdAt: true,
      provider: {
        select: {
          name: true,
          providerProfile: {
            select: {
              ratingAverage: true,
              ratingCount: true,
              completedJobs: true,
              providerKind: true,
              workshopName: true,
            },
          },
        },
      },
    },
    orderBy: [{ totalSyp: "asc" }, { etaMinutes: "asc" }],
  });
}

export type OfferForCustomer = Awaited<ReturnType<typeof listOffersForRequest>>[number];

export interface AcceptOfferParams {
  requestId: string;
  offerId: string;
  actor: "CUSTOMER" | "ADMIN";
  actorUserId: string;
  ip?: string | null;
  now?: Date;
}

/**
 * Books the request with this offer, atomically.
 *
 * Idempotent: accepting the offer that is already accepted succeeds quietly,
 * so a retry after a dropped connection is harmless.
 */
export async function acceptOffer(params: AcceptOfferParams): Promise<{ alreadyAccepted: boolean }> {
  const { requestId, offerId, actor, actorUserId, ip } = params;
  const now = params.now ?? new Date();
  const commissionPolicy = await readSetting("commissionPolicy");
  const commission = effectiveCommission(commissionPolicy, now);

  const result = await prisma.$transaction(async (tx) => {
    const offer = await tx.requestOffer.findUnique({
      where: { id: offerId },
      select: {
        id: true,
        requestId: true,
        providerId: true,
        status: true,
        validUntil: true,
        etaMinutes: true,
        request: {
          select: { customerId: true, status: true, acceptedOfferId: true },
        },
      },
    });

    if (!offer || offer.requestId !== requestId) throw new DomainError("NOT_FOUND");
    if (actor === "CUSTOMER" && offer.request.customerId !== actorUserId) {
      throw new DomainError("NOT_FOUND");
    }

    // Retry of a booking that already went through.
    if (offer.request.acceptedOfferId === offer.id) return { alreadyAccepted: true };

    if (offer.request.status !== "SEARCHING") throw new DomainError("ALREADY_BOOKED");
    if (offer.status !== "PENDING") throw new DomainError("OFFER_NOT_AVAILABLE");
    if (offer.validUntil <= now) throw new DomainError("OFFER_EXPIRED");

    // Serialise every booking of THIS provider, across all requests, until
    // this transaction ends - so two customers accepting the same provider's
    // offers at the same instant cannot both succeed.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${offer.providerId}))`;

    const candidate = await loadCandidate(tx, offer.providerId);
    if (!candidate || candidate.userStatus !== "ACTIVE" || candidate.profileStatus !== "ACTIVE") {
      throw new DomainError("OFFER_NOT_AVAILABLE");
    }
    if (candidate.hasActiveJob) throw new DomainError("PROVIDER_BUSY");

    // Compare-and-swap: only a request that is still searching with nobody
    // assigned can be booked. The loser of a race updates zero rows.
    await applyTransition(tx, {
      requestId,
      from: "SEARCHING",
      to: "CONFIRMED",
      actor,
      actorUserId,
      note: actor === "ADMIN" ? "offer accepted by admin for customer" : "offer accepted",
      where: { assignedProviderId: null, acceptedOfferId: null },
      data: {
        assignedProviderId: offer.providerId,
        acceptedOfferId: offer.id,
        assignedAt: now,
        feeTermsAcceptedAt: now,
        etaAt: new Date(now.getTime() + offer.etaMinutes * 60_000),
        // Snapshot: later policy changes never touch this request.
        commissionEnabled: commission.enabled,
        commissionRateBps: commission.enabled ? commission.rateBps : 0,
        commissionBase: commission.enabled ? commission.base : null,
      },
    });

    await tx.requestOffer.update({
      where: { id: offer.id },
      data: { status: "ACCEPTED", respondedAt: now },
    });
    await tx.requestOffer.updateMany({
      where: { requestId, status: "PENDING", id: { not: offer.id } },
      data: { status: "NOT_SELECTED", respondedAt: now },
    });

    return { alreadyAccepted: false };
  }, {
    // Generous on purpose: a slow VPS or a cold start must not turn a
    // booking the customer is waiting on into an error. The locks involved
    // are per request and per provider, so a slow booking blocks nobody else.
    maxWait: 5_000,
    timeout: 15_000,
  }).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "CONCURRENT_UPDATE") {
      throw new DomainError("ALREADY_BOOKED");
    }
    if (isUniqueViolation(error)) throw new DomainError("ALREADY_BOOKED");
    throw error;
  });

  if (!result.alreadyAccepted) {
    log.info({ requestId, offerId, actor }, "offer accepted");
    await audit({
      actorId: actorUserId,
      action: "offer.accepted",
      entityType: "ServiceRequest",
      entityId: requestId,
      metadata: { offerId, actor, commission },
      ip,
    });
  }

  return result;
}
