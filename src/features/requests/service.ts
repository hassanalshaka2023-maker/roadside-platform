/**
 * Service-request domain logic: creating, reading, timing out, cancelling and
 * restarting requests.
 *
 * Route handlers and server actions do authentication, CSRF and rate
 * limiting; everything here assumes it has been told who the actor is, but
 * still re-checks ownership itself - "the caller already checked" is how
 * authorization bugs happen.
 *
 * The rule this module exists to guarantee: a request's status NEVER changes
 * without the state machine agreeing AND a history row being written in the
 * same transaction (see ./transition.ts).
 */
import "server-only";

import { Prisma, type RequestStatus } from "@prisma/client";

import { audit } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { attachFiles, ownsAttachableFiles } from "@/lib/files/service";
import { loggerFor } from "@/lib/logger";
import {
  notifyBookingCancelled,
  notifyProviderInvited,
  notifyRequestSearching,
  notifySearchEnded,
} from "@/features/notifications/events";
import { readMatchingSettings } from "@/features/settings/platform";
import { DomainError } from "./errors";
import type { CreateRequestInput } from "./schemas";
import {
  customerCanCancel,
  SEARCH_ENDED_STATUSES,
  type RequestStatusName,
  type TransitionActor,
} from "./state-machine";
import { applyTransition, loadForTransition, type Tx } from "./transition";

const log = loggerFor("requests/service");

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** What the customer sees about their own request. */
export const customerRequestSelect = {
  id: true,
  publicCode: true,
  trackingToken: true,
  status: true,
  lat: true,
  lng: true,
  locationApproximate: true,
  governorate: true,
  addressText: true,
  landmarkText: true,
  carMake: true,
  carModel: true,
  carYear: true,
  plateNumber: true,
  carCategory: true,
  vehicleCanRoll: true,
  problemDescription: true,
  problemUnknown: true,
  photoIds: true,
  destinationText: true,
  searchStartedAt: true,
  searchExpiresAt: true,
  searchAttempts: true,
  fallbackFromId: true,
  etaAt: true,
  finalAmountSyp: true,
  providerConfirmedAt: true,
  customerConfirmedAt: true,
  disputeReason: true,
  disputeResolution: true,
  cancelledReason: true,
  feeTermsAcceptedAt: true,
  createdAt: true,
  assignedAt: true,
  completedAt: true,
  customerId: true,
  assignedProviderId: true,
  serviceType: {
    select: {
      id: true,
      slug: true,
      nameAr: true,
      nameEn: true,
      pricingNoteAr: true,
      pricingNoteEn: true,
      requiresDestination: true,
    },
  },
  acceptedOffer: {
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
      createdAt: true,
      respondedAt: true,
    },
  },
  assignedProvider: {
    select: {
      name: true,
      phone: true,
      contactPhone: true,
      providerProfile: {
        select: { ratingAverage: true, ratingCount: true, workshopName: true },
      },
    },
  },
  rating: { select: { stars: true, comment: true, createdAt: true } },
} satisfies Prisma.ServiceRequestSelect;

export type CustomerRequest = Prisma.ServiceRequestGetPayload<{
  select: typeof customerRequestSelect;
}>;

/**
 * Looks a request up by its secret tracking token - the ONLY lookup that
 * works without a session, which is why the token is unguessable and why
 * `publicCode` must never be accepted here.
 */
export async function getByTrackingToken(token: string): Promise<CustomerRequest | null> {
  return prisma.serviceRequest.findUnique({
    where: { trackingToken: token },
    select: customerRequestSelect,
  });
}

export async function listForCustomer(customerId: string, limit = 30) {
  return prisma.serviceRequest.findMany({
    where: { customerId },
    select: {
      id: true,
      publicCode: true,
      trackingToken: true,
      status: true,
      createdAt: true,
      finalAmountSyp: true,
      serviceType: { select: { nameAr: true, nameEn: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export interface StatusHistoryEntry {
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  note: string | null;
  createdAt: Date;
}

export async function getStatusHistory(requestId: string): Promise<StatusHistoryEntry[]> {
  return prisma.requestStatusHistory.findMany({
    where: { requestId },
    select: { fromStatus: true, toStatus: true, note: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

// ---------------------------------------------------------------------------
// ID requirement
// ---------------------------------------------------------------------------

export type CustomerIdMode = "NEVER" | "FIRST_REQUEST_ONLY" | "ALWAYS";

/**
 * Whether this customer must attach an ID document for this request.
 *
 * FIRST_REQUEST_ONLY stops asking once we hold one, because asking again
 * would mean storing a second copy of the same sensitive scan.
 */
export async function isIdRequiredFor(customerId: string, mode: CustomerIdMode): Promise<boolean> {
  if (mode === "NEVER") return false;
  if (mode === "ALWAYS") return true;

  const profile = await prisma.customerProfile.findUnique({
    where: { userId: customerId },
    select: { idVerified: true, idDocumentId: true },
  });

  if (profile?.idVerified || profile?.idDocumentId) return false;

  const previous = await prisma.serviceRequest.count({ where: { customerId } });
  return previous === 0;
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

export interface CreateRequestParams {
  customerId: string;
  input: CreateRequestInput;
  /** True when settings demand an ID and this customer has not given one. */
  idRequired: boolean;
  /** Set when this is the towing fallback of a failed repair search. */
  fallbackFromId?: string;
  ip?: string | null;
}

export interface CreatedRequest {
  id: string;
  publicCode: string;
  trackingToken: string;
  /** False when a retry returned a request created earlier. */
  created: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function findByClientId(customerId: string, clientRequestId: string) {
  return prisma.serviceRequest.findUnique({
    where: { customerId_clientRequestId: { customerId, clientRequestId } },
    select: { id: true, publicCode: true, trackingToken: true },
  });
}

/**
 * Creates a request, its first history row and its file links atomically.
 *
 * IDEMPOTENT: the browser sends the same clientRequestId on every retry, so a
 * customer on a flaky connection who taps "send" three times gets one request.
 */
export async function createRequest(params: CreateRequestParams): Promise<CreatedRequest> {
  const { customerId, input, idRequired, fallbackFromId, ip } = params;

  const existing = await findByClientId(customerId, input.clientRequestId);
  if (existing) return { ...existing, created: false };

  if (idRequired && !input.idFrontFileId) throw new DomainError("ID_REQUIRED");

  const serviceType = await prisma.serviceType.findFirst({
    where: { id: input.serviceTypeId, isActive: true },
    select: { id: true, requiresDestination: true },
  });
  if (!serviceType) throw new DomainError("NOT_FOUND", "service type");

  if (serviceType.requiresDestination && !input.destinationText) {
    throw new DomainError("DESTINATION_REQUIRED");
  }

  const fileIds = [...(input.photoIds ?? [])];
  const photosOk = await ownsAttachableFiles(fileIds, customerId, ["REQUEST_PHOTO"]);
  const idOk = input.idFrontFileId
    ? await ownsAttachableFiles([input.idFrontFileId], customerId, ["ID_FRONT"])
    : true;
  if (!photosOk || !idOk) throw new DomainError("NOT_FOUND", "attached file");

  const settings = await readMatchingSettings();
  const now = new Date();
  const trackingToken = randomToken(32);

  let created: { id: string; publicCode: string; trackingToken: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.create({
        data: {
          customerId,
          clientRequestId: input.clientRequestId,
          serviceTypeId: serviceType.id,
          trackingToken,
          status: "SEARCHING",
          lat: input.lat,
          lng: input.lng,
          locationApproximate: input.locationApproximate ?? false,
          governorate: input.governorate,
          addressText: input.addressText || null,
          landmarkText: input.landmarkText || null,
          carMake: input.carMake || null,
          carModel: input.carModel || null,
          carYear: input.carYear ?? null,
          plateNumber: input.plateNumber || null,
          carCategory: input.carCategory ?? null,
          problemDescription: input.problemDescription || null,
          problemUnknown: input.problemUnknown ?? false,
          photoIds: fileIds,
          destinationText: serviceType.requiresDestination ? input.destinationText || null : null,
          destinationLat: serviceType.requiresDestination ? (input.destinationLat ?? null) : null,
          destinationLng: serviceType.requiresDestination ? (input.destinationLng ?? null) : null,
          vehicleCanRoll: serviceType.requiresDestination ? (input.vehicleCanRoll ?? null) : null,
          fallbackFromId: fallbackFromId ?? null,
          searchStartedAt: now,
          searchExpiresAt: new Date(now.getTime() + settings.searchTimeoutMinutes * 60_000),
        },
        select: { id: true, publicCode: true, trackingToken: true },
      });

      await tx.requestStatusHistory.create({
        data: {
          requestId: request.id,
          fromStatus: null,
          toStatus: "SEARCHING",
          changedByUserId: customerId,
          note: fallbackFromId ? "towing fallback" : "created by customer",
        },
      });

      const toAttach = [...fileIds];
      if (input.idFrontFileId) toAttach.push(input.idFrontFileId);
      await attachFiles(toAttach, tx);

      if (input.idFrontFileId) {
        await tx.customerProfile.upsert({
          where: { userId: customerId },
          create: { userId: customerId, idDocumentId: input.idFrontFileId },
          update: { idDocumentId: input.idFrontFileId },
        });
      }

      return request;
    });
  } catch (error) {
    // Two retries raced past the lookup above: the loser gets the winner's row.
    if (isUniqueViolation(error)) {
      const winner = await findByClientId(customerId, input.clientRequestId);
      if (winner) return { ...winner, created: false };
    }
    throw error;
  }

  log.info({ requestId: created.id, publicCode: created.publicCode }, "service request created");

  await audit({
    actorId: customerId,
    action: "request.created",
    entityType: "ServiceRequest",
    entityId: created.id,
    metadata: {
      publicCode: created.publicCode,
      serviceTypeId: serviceType.id,
      withId: Boolean(input.idFrontFileId),
      photoCount: fileIds.length,
      fallbackFromId: fallbackFromId ?? null,
    },
    ip,
  });

  notifyRequestSearching(created.id);

  return { ...created, created: true };
}

// ---------------------------------------------------------------------------
// Search timeout
// ---------------------------------------------------------------------------

/**
 * Closes searches whose window has passed, and expires stale offers.
 *
 * Called lazily whenever a list or tracking page is read, and by
 * `npm run jobs:sweep` for a cron. Both are safe to run concurrently: each
 * close is a compare-and-swap, so a request is closed exactly once.
 *
 * A search stays open while an unexpired offer is waiting - the customer
 * never loses an offer they are looking at because a timer ran out.
 *
 * Result: EXPIRED if any offer came in this round (the customer just did not
 * pick one), NO_PROVIDER_AVAILABLE if none did. Only this sweep decides "no
 * provider available", and only from real data: a network error never
 * reaches here.
 */
export async function sweepExpiredSearches(now: Date = new Date()): Promise<number> {
  await prisma.requestOffer.updateMany({
    where: { status: "PENDING", validUntil: { lt: now } },
    data: { status: "EXPIRED", respondedAt: now },
  });

  const due = await prisma.serviceRequest.findMany({
    where: {
      status: "SEARCHING",
      searchExpiresAt: { lt: now },
      offers: { none: { status: "PENDING", validUntil: { gte: now } } },
    },
    select: { id: true, searchStartedAt: true },
    take: 100,
  });

  let closed = 0;
  for (const request of due) {
    try {
      const to = await prisma.$transaction(async (tx) => {
        const offersThisRound = await tx.requestOffer.count({
          where: {
            requestId: request.id,
            createdAt: { gte: request.searchStartedAt ?? new Date(0) },
          },
        });
        const to: RequestStatusName = offersThisRound > 0 ? "EXPIRED" : "NO_PROVIDER_AVAILABLE";
        await applyTransition(tx, {
          requestId: request.id,
          from: "SEARCHING",
          to,
          actor: "SYSTEM",
          actorUserId: null,
          note: "search window closed",
        });
        return to;
      });
      closed += 1;
      notifySearchEnded(request.id, to === "EXPIRED");
    } catch (error) {
      // Someone accepted or cancelled at the same moment: they won, fine.
      if (error instanceof DomainError) continue;
      log.error({ err: error, requestId: request.id }, "search sweep failed for request");
    }
  }

  if (closed > 0) log.info({ closed }, "closed expired searches");
  return closed;
}

/** Best-effort wrapper for page loads: a sweep failure must not break a page. */
export async function sweepQuietly(): Promise<void> {
  try {
    await sweepExpiredSearches();
  } catch (error) {
    log.error({ err: error }, "lazy sweep failed");
  }
}

// ---------------------------------------------------------------------------
// Shared: releasing a booking
// ---------------------------------------------------------------------------

/**
 * Puts a booked request back into the pool: the provider dropped out, or an
 * admin reassigns. The accepted offer is WITHDRAWN (its money stays frozen as
 * a record), pending extras die with the booking, and a fresh search round
 * starts.
 */
export async function releaseBooking(
  tx: Tx,
  params: {
    requestId: string;
    from: RequestStatusName;
    actor: TransitionActor;
    actorUserId: string | null;
    note: string;
  },
): Promise<void> {
  const current = await loadForTransition(tx, params.requestId);
  const settings = await readMatchingSettings();
  const now = new Date();

  await applyTransition(tx, {
    requestId: params.requestId,
    from: params.from,
    to: "SEARCHING",
    actor: params.actor,
    actorUserId: params.actorUserId,
    note: params.note,
    data: {
      assignedProviderId: null,
      acceptedOfferId: null,
      assignedAt: null,
      etaAt: null,
      feeTermsAcceptedAt: null,
      commissionEnabled: false,
      commissionRateBps: 0,
      commissionBase: null,
      searchStartedAt: now,
      searchExpiresAt: new Date(now.getTime() + settings.searchTimeoutMinutes * 60_000),
      searchAttempts: { increment: 1 },
    },
  });

  if (current.acceptedOfferId) {
    await tx.requestOffer.update({
      where: { id: current.acceptedOfferId },
      data: { status: "WITHDRAWN", respondedAt: now },
    });
  }

  await tx.extraCharge.updateMany({
    where: { requestId: params.requestId, status: "PENDING" },
    data: { status: "WITHDRAWN", respondedAt: now },
  });
}

/** Closes any offers still open on a request that has stopped searching. */
async function closeOpenOffers(tx: Tx, requestId: string): Promise<void> {
  await tx.requestOffer.updateMany({
    where: { requestId, status: "PENDING" },
    data: { status: "NOT_SELECTED", respondedAt: new Date() },
  });
  await tx.extraCharge.updateMany({
    where: { requestId, status: "PENDING" },
    data: { status: "WITHDRAWN", respondedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Customer actions
// ---------------------------------------------------------------------------

async function loadOwned(tx: Tx, requestId: string, customerId: string) {
  const request = await loadForTransition(tx, requestId);
  // Same error for "missing" and "someone else's", so ids cannot be probed.
  if (request.customerId !== customerId) throw new DomainError("NOT_FOUND");
  return request;
}

export async function cancelByCustomer(params: {
  requestId: string;
  customerId: string;
  reason?: string;
  ip?: string | null;
}): Promise<void> {
  const { requestId, customerId, reason, ip } = params;

  const { from, providerId } = await prisma.$transaction(async (tx) => {
    const request = await loadOwned(tx, requestId, customerId);
    if (!customerCanCancel(request.status)) {
      throw new DomainError("ILLEGAL_TRANSITION", `cancel from ${request.status}`);
    }
    await applyTransition(tx, {
      requestId,
      from: request.status,
      to: "CANCELLED_BY_CUSTOMER",
      actor: "CUSTOMER",
      actorUserId: customerId,
      note: "cancelled by customer",
      data: { cancelledReason: reason || null },
    });
    await closeOpenOffers(tx, requestId);
    return { from: request.status, providerId: request.assignedProviderId };
  });

  await audit({
    actorId: customerId,
    action: "request.status.changed",
    entityType: "ServiceRequest",
    entityId: requestId,
    metadata: { from, to: "CANCELLED_BY_CUSTOMER", actor: "CUSTOMER" },
    ip,
  });

  notifyBookingCancelled(requestId, providerId, "customer");
}

/** "Search again" after a search ended with nobody booked. */
export async function restartSearch(params: {
  requestId: string;
  actor: "CUSTOMER" | "ADMIN";
  actorUserId: string;
  ip?: string | null;
}): Promise<void> {
  const { requestId, actor, actorUserId, ip } = params;
  const settings = await readMatchingSettings();

  const from = await prisma.$transaction(async (tx) => {
    const request =
      actor === "CUSTOMER"
        ? await loadOwned(tx, requestId, actorUserId)
        : await loadForTransition(tx, requestId);

    if (!SEARCH_ENDED_STATUSES.includes(request.status)) {
      throw new DomainError("ILLEGAL_TRANSITION", `restart from ${request.status}`);
    }
    const now = new Date();
    await applyTransition(tx, {
      requestId,
      from: request.status,
      to: "SEARCHING",
      actor,
      actorUserId,
      note: "search restarted",
      data: {
        searchStartedAt: now,
        searchExpiresAt: new Date(now.getTime() + settings.searchTimeoutMinutes * 60_000),
        searchAttempts: { increment: 1 },
      },
    });
    return request.status;
  });

  await audit({
    actorId: actorUserId,
    action: "request.status.changed",
    entityType: "ServiceRequest",
    entityId: requestId,
    metadata: { from, to: "SEARCHING", actor, reason: "restart" },
    ip,
  });

  notifyRequestSearching(requestId);
}

/**
 * The towing fallback: nobody could repair the car where it is, so offer to
 * move it. Only ever created by the customer's explicit confirmation, keeps
 * the location and car details, and needs a destination. Never offered when
 * the original request was already a tow.
 */
export async function createTowingFallback(params: {
  requestId: string;
  customerId: string;
  clientRequestId: string;
  destinationText: string;
  destinationLat?: number;
  destinationLng?: number;
  vehicleCanRoll?: boolean;
  ip?: string | null;
}): Promise<CreatedRequest> {
  const { requestId, customerId, ip } = params;

  // A repeat of a fallback that already went through.
  const previous = await findByClientId(customerId, params.clientRequestId);
  if (previous) return { ...previous, created: false };

  const original = await prisma.serviceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      customerId: true,
      status: true,
      lat: true,
      lng: true,
      locationApproximate: true,
      governorate: true,
      addressText: true,
      landmarkText: true,
      carMake: true,
      carModel: true,
      carYear: true,
      plateNumber: true,
      carCategory: true,
      problemDescription: true,
      problemUnknown: true,
      serviceType: { select: { requiresDestination: true } },
    },
  });

  if (!original || original.customerId !== customerId) throw new DomainError("NOT_FOUND");
  if (original.serviceType.requiresDestination) throw new DomainError("FALLBACK_NOT_ALLOWED");
  if (!SEARCH_ENDED_STATUSES.includes(original.status as RequestStatusName)) {
    throw new DomainError("FALLBACK_NOT_ALLOWED");
  }

  const towing = await prisma.serviceType.findFirst({
    where: { requiresDestination: true, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  if (!towing) throw new DomainError("NOT_FOUND", "towing service");

  const created = await createRequest({
    customerId,
    idRequired: false,
    fallbackFromId: original.id,
    ip,
    input: {
      clientRequestId: params.clientRequestId,
      serviceTypeId: towing.id,
      lat: original.lat,
      lng: original.lng,
      locationApproximate: original.locationApproximate,
      governorate: original.governorate ?? "damascus",
      addressText: original.addressText ?? "",
      landmarkText: original.landmarkText ?? "",
      carMake: original.carMake ?? "",
      carModel: original.carModel ?? "",
      carYear: original.carYear ?? undefined,
      plateNumber: original.plateNumber ?? "",
      carCategory: original.carCategory ?? undefined,
      problemDescription: original.problemDescription ?? "",
      problemUnknown: original.problemUnknown,
      destinationText: params.destinationText,
      destinationLat: params.destinationLat,
      destinationLng: params.destinationLng,
      vehicleCanRoll: params.vehicleCanRoll,
      photoIds: [],
    },
  });

  // Close the original so the customer is not left with two open requests.
  // Best effort: a retry may find it already closed.
  if (created.created) {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await loadOwned(tx, original.id, customerId);
        if (!SEARCH_ENDED_STATUSES.includes(current.status)) return;
        await applyTransition(tx, {
          requestId: original.id,
          from: current.status,
          to: "CANCELLED_BY_CUSTOMER",
          actor: "CUSTOMER",
          actorUserId: customerId,
          note: `replaced by towing request ${created.publicCode}`,
          data: { cancelledReason: "towing fallback" },
        });
      });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

export async function cancelByAdmin(params: {
  requestId: string;
  adminId: string;
  reason: string;
  ip?: string | null;
}): Promise<void> {
  const { requestId, adminId, reason, ip } = params;

  const { from, providerId } = await prisma.$transaction(async (tx) => {
    const request = await loadForTransition(tx, requestId);
    await applyTransition(tx, {
      requestId,
      from: request.status,
      to: "CANCELLED_BY_ADMIN",
      actor: "ADMIN",
      actorUserId: adminId,
      note: reason,
      data: { cancelledReason: reason },
    });
    await closeOpenOffers(tx, requestId);
    return { from: request.status, providerId: request.assignedProviderId };
  });

  await audit({
    actorId: adminId,
    action: "request.status.changed",
    entityType: "ServiceRequest",
    entityId: requestId,
    metadata: { from, to: "CANCELLED_BY_ADMIN", actor: "ADMIN", reason },
    ip,
  });

  notifyBookingCancelled(requestId, providerId, "admin");
}

/** Admin pulls a booked request back to searching (provider no-show etc.). */
export async function reassignByAdmin(params: {
  requestId: string;
  adminId: string;
  reason: string;
  ip?: string | null;
}): Promise<void> {
  const { requestId, adminId, reason, ip } = params;

  const { from, providerId } = await prisma.$transaction(async (tx) => {
    const request = await loadForTransition(tx, requestId);
    await releaseBooking(tx, {
      requestId,
      from: request.status,
      actor: "ADMIN",
      actorUserId: adminId,
      note: `reassigned by admin: ${reason}`,
    });
    return { from: request.status, providerId: request.assignedProviderId };
  });

  await audit({
    actorId: adminId,
    action: "request.status.changed",
    entityType: "ServiceRequest",
    entityId: requestId,
    metadata: { from, to: "SEARCHING", actor: "ADMIN", reason: "reassign", note: reason },
    ip,
  });

  notifyBookingCancelled(requestId, providerId, "admin");
  notifyRequestSearching(requestId, providerId ? [providerId] : []);
}

/**
 * Admin points a searching request at a specific provider (the manual half of
 * hybrid dispatch). The provider sees it in their feed even if they are out of
 * range or toggled unavailable, but still has to send an offer, and the
 * customer still has to accept it.
 */
export async function inviteProvider(params: {
  requestId: string;
  providerUserId: string;
  adminId: string;
  ip?: string | null;
}): Promise<void> {
  const { requestId, providerUserId, adminId, ip } = params;

  const request = await prisma.serviceRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!request) throw new DomainError("NOT_FOUND");
  if (request.status !== "SEARCHING") throw new DomainError("REQUEST_NOT_OPEN");

  const provider = await prisma.providerProfile.findUnique({
    where: { userId: providerUserId },
    select: { status: true, user: { select: { status: true } } },
  });
  if (!provider || provider.status !== "ACTIVE" || provider.user.status !== "ACTIVE") {
    throw new DomainError("NOT_ELIGIBLE");
  }

  await prisma.requestInvite.upsert({
    where: { requestId_providerId: { requestId, providerId: providerUserId } },
    create: { requestId, providerId: providerUserId, invitedById: adminId },
    update: {},
  });

  await audit({
    actorId: adminId,
    action: "request.invite.sent",
    entityType: "ServiceRequest",
    entityId: requestId,
    metadata: { providerUserId },
    ip,
  });

  notifyProviderInvited(requestId, providerUserId);
}
