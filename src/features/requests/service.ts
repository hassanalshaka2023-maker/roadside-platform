/**
 * Service-request domain logic.
 *
 * The route handlers and server actions do authentication, CSRF and rate
 * limiting; everything here assumes it has already been told who the actor
 * is. Nothing in this file reads cookies or headers.
 *
 * The rule this module exists to guarantee: a request's status NEVER changes
 * without the state machine agreeing AND a history row being written in the
 * same transaction.
 */
import "server-only";

import type { Prisma, RequestStatus } from "@prisma/client";

import { audit } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { attachFiles } from "@/lib/files/service";
import { loggerFor } from "@/lib/logger";
import {
  assertTransition,
  customerCanCancel,
  type RequestStatusName,
  type TransitionActor,
} from "./state-machine";
import type { CreateRequestInput } from "./schemas";

const log = loggerFor("requests/service");

export class RequestNotFoundError extends Error {
  constructor() {
    super("Request not found");
    this.name = "RequestNotFoundError";
  }
}

export class IdDocumentRequiredError extends Error {
  constructor() {
    super("An ID document is required for this request");
    this.name = "IdDocumentRequiredError";
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Everything the tracking page and the customer's list need. */
const requestSelect = {
  id: true,
  publicCode: true,
  trackingToken: true,
  status: true,
  lat: true,
  lng: true,
  addressText: true,
  landmarkText: true,
  carMake: true,
  carModel: true,
  carYear: true,
  plateNumber: true,
  problemDescription: true,
  photoIds: true,
  estimatedPrice: true,
  finalPrice: true,
  cancelledReason: true,
  createdAt: true,
  assignedAt: true,
  acceptedAt: true,
  completedAt: true,
  customerId: true,
  assignedProviderId: true,
  serviceType: {
    select: { slug: true, nameAr: true, nameEn: true },
  },
  assignedProvider: {
    select: { name: true, phone: true },
  },
} satisfies Prisma.ServiceRequestSelect;

export type RequestDetail = Prisma.ServiceRequestGetPayload<{
  select: typeof requestSelect;
}>;

/**
 * Looks a request up by its secret tracking token.
 *
 * This is the ONLY lookup that works without a session, which is why the
 * token has to be unguessable - and why `publicCode` must never be accepted
 * here, since it is sequential.
 */
export async function getByTrackingToken(
  token: string,
): Promise<RequestDetail | null> {
  return prisma.serviceRequest.findUnique({
    where: { trackingToken: token },
    select: requestSelect,
  });
}

export async function listForCustomer(
  customerId: string,
  limit = 20,
): Promise<RequestDetail[]> {
  return prisma.serviceRequest.findMany({
    where: { customerId },
    select: requestSelect,
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

export async function getStatusHistory(
  requestId: string,
): Promise<StatusHistoryEntry[]> {
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
 * FIRST_REQUEST_ONLY means what it says: once they have one accepted request
 * on file we stop asking, because we already hold the document and asking
 * again would mean storing a second copy of the same sensitive scan.
 */
export async function isIdRequiredFor(
  customerId: string,
  mode: CustomerIdMode,
): Promise<boolean> {
  if (mode === "NEVER") return false;
  if (mode === "ALWAYS") return true;

  const profile = await prisma.customerProfile.findUnique({
    where: { userId: customerId },
    select: { idVerified: true, idDocumentId: true },
  });

  if (profile?.idVerified || profile?.idDocumentId) return false;

  const previous = await prisma.serviceRequest.count({
    where: { customerId },
  });

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
  ip?: string | null;
}

export interface CreatedRequest {
  id: string;
  publicCode: string;
  trackingToken: string;
}

/**
 * Creates a request, its first history row and its file links atomically.
 *
 * All in one transaction on purpose: a request without its opening history
 * row would be a request whose origin cannot be proven, and photos attached
 * to a request that failed to save would be orphans holding storage.
 */
export async function createRequest(
  params: CreateRequestParams,
): Promise<CreatedRequest> {
  const { customerId, input, idRequired, ip } = params;

  if (idRequired && !input.idFrontFileId) {
    throw new IdDocumentRequiredError();
  }

  // Unguessable, and generated here rather than by the database so the same
  // code path produces it in every environment.
  const trackingToken = randomToken(32);

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.serviceRequest.create({
      data: {
        customerId,
        serviceTypeId: input.serviceTypeId,
        trackingToken,
        status: "PENDING",
        lat: input.lat,
        lng: input.lng,
        addressText: input.addressText || null,
        landmarkText: input.landmarkText || null,
        carMake: input.carMake || null,
        carModel: input.carModel || null,
        carYear: input.carYear ?? null,
        plateNumber: input.plateNumber || null,
        problemDescription: input.problemDescription || null,
        photoIds: input.photoIds ?? [],
      },
      select: { id: true, publicCode: true, trackingToken: true },
    });

    // The opening entry: fromStatus is null because nothing preceded it.
    await tx.requestStatusHistory.create({
      data: {
        requestId: request.id,
        fromStatus: null,
        toStatus: "PENDING",
        changedByUserId: customerId,
        note: "created by customer",
      },
    });

    // Mark the photos as belonging to something, so the orphan sweep leaves
    // them alone.
    const fileIds = [...(input.photoIds ?? [])];
    if (input.idFrontFileId) fileIds.push(input.idFrontFileId);
    if (fileIds.length > 0) await attachFiles(fileIds, tx);

    // Record the ID document and the consent against the customer profile.
    if (input.idFrontFileId) {
      await tx.customerProfile.upsert({
        where: { userId: customerId },
        create: { userId: customerId, idDocumentId: input.idFrontFileId },
        update: { idDocumentId: input.idFrontFileId },
      });
    }

    return request;
  });

  log.info(
    { requestId: created.id, publicCode: created.publicCode },
    "service request created",
  );

  await audit({
    actorId: customerId,
    action: "request.created",
    entityType: "ServiceRequest",
    entityId: created.id,
    metadata: {
      publicCode: created.publicCode,
      serviceTypeId: input.serviceTypeId,
      withId: Boolean(input.idFrontFileId),
      photoCount: input.photoIds?.length ?? 0,
    },
    ip,
  });

  return created;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/** Timestamp columns that a given target status also stamps. */
const STATUS_TIMESTAMPS: Partial<Record<RequestStatusName, keyof Prisma.ServiceRequestUpdateInput>> = {
  ASSIGNED: "assignedAt",
  ACCEPTED: "acceptedAt",
  COMPLETED: "completedAt",
};

export interface TransitionParams {
  requestId: string;
  to: RequestStatusName;
  actor: TransitionActor;
  actorUserId: string | null;
  note?: string;
  /** Only meaningful when moving to a cancelled state. */
  cancelledReason?: string;
  ip?: string | null;
}

/**
 * The single way a request's status ever changes.
 *
 * Re-reads the current status INSIDE the transaction and guards the update
 * with it, so two people acting at the same moment cannot both win - the
 * second one's update matches zero rows and is rejected.
 */
export async function transitionRequest(
  params: TransitionParams,
): Promise<RequestStatusName> {
  const { requestId, to, actor, actorUserId, note, cancelledReason, ip } = params;

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.serviceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true },
    });

    if (!current) throw new RequestNotFoundError();

    const from = current.status as RequestStatusName;

    // Throws IllegalTransitionError, which the caller maps to a message.
    assertTransition(from, to, actor);

    const data: Prisma.ServiceRequestUpdateInput = { status: to };

    const timestampField = STATUS_TIMESTAMPS[to];
    if (timestampField) {
      (data as Record<string, unknown>)[timestampField] = new Date();
    }

    if (cancelledReason) data.cancelledReason = cancelledReason;

    // The `status: from` guard makes this a compare-and-swap: if anything
    // moved the request since we read it, this updates nothing.
    const updated = await tx.serviceRequest.updateMany({
      where: { id: requestId, status: from },
      data,
    });

    if (updated.count === 0) {
      throw new Error("Request status changed concurrently; transition aborted");
    }

    await tx.requestStatusHistory.create({
      data: {
        requestId,
        fromStatus: from,
        toStatus: to,
        changedByUserId: actorUserId,
        note: note ?? null,
      },
    });

    return { from, to };
  });

  log.info({ requestId, from: result.from, to: result.to, actor }, "request transitioned");

  await audit({
    actorId: actorUserId,
    action: "request.status.changed",
    entityType: "ServiceRequest",
    entityId: requestId,
    metadata: { from: result.from, to: result.to, actor },
    ip,
  });

  return result.to;
}

// ---------------------------------------------------------------------------
// Customer cancellation
// ---------------------------------------------------------------------------

export interface CancelParams {
  requestId: string;
  customerId: string;
  reason?: string;
  ip?: string | null;
}

/**
 * Cancels a request on the customer's behalf.
 *
 * Ownership is checked here as well as in the action: this function must be
 * safe to call from anywhere, and "the caller already checked" is how
 * authorization bugs happen.
 */
export async function cancelByCustomer(params: CancelParams): Promise<void> {
  const { requestId, customerId, reason, ip } = params;

  const request = await prisma.serviceRequest.findUnique({
    where: { id: requestId },
    select: { id: true, customerId: true, status: true },
  });

  if (!request || request.customerId !== customerId) {
    // Same error whether it does not exist or belongs to someone else, so
    // this cannot be used to probe for request ids.
    throw new RequestNotFoundError();
  }

  if (!customerCanCancel(request.status as RequestStatusName)) {
    // Let the state machine produce the precise refusal.
    assertTransition(
      request.status as RequestStatusName,
      "CANCELLED_BY_CUSTOMER",
      "CUSTOMER",
    );
  }

  await transitionRequest({
    requestId,
    to: "CANCELLED_BY_CUSTOMER",
    actor: "CUSTOMER",
    actorUserId: customerId,
    cancelledReason: reason || undefined,
    note: "cancelled by customer",
    ip,
  });
}
