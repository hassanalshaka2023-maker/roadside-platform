/**
 * The single way a request's status ever changes.
 *
 * Runs inside the caller's transaction, so a status change and whatever it
 * implies (booking a provider, freezing an offer, writing a commission entry)
 * commit or fail together. Guarded by compare-and-swap on the status the
 * caller just read: if anyone moved the request in between, the update
 * matches zero rows and the whole transaction aborts.
 */
import "server-only";

import type { Prisma, RequestStatus } from "@prisma/client";

import { DomainError } from "./errors";
import {
  checkTransition,
  type RequestStatusName,
  type TransitionActor,
} from "./state-machine";

export type Tx = Prisma.TransactionClient;

export interface ApplyTransitionParams {
  requestId: string;
  /** The status the caller read. The update only applies if it still holds. */
  from: RequestStatusName;
  to: RequestStatusName;
  actor: TransitionActor;
  actorUserId: string | null;
  note?: string;
  /** Extra columns written in the same UPDATE. */
  data?: Prisma.ServiceRequestUncheckedUpdateManyInput;
  /** Extra WHERE conditions, e.g. `assignedProviderId: null`. */
  where?: Prisma.ServiceRequestWhereInput;
}

export async function applyTransition(tx: Tx, params: ApplyTransitionParams): Promise<void> {
  const { requestId, from, to, actor, actorUserId, note, data, where } = params;

  const check = checkTransition(from, to, actor);
  if (!check.ok) throw new DomainError("ILLEGAL_TRANSITION", `${from}->${to} by ${actor}: ${check.reason}`);

  const updated = await tx.serviceRequest.updateMany({
    where: { ...where, id: requestId, status: from as RequestStatus },
    data: { ...data, status: to as RequestStatus },
  });

  if (updated.count === 0) throw new DomainError("CONCURRENT_UPDATE");

  await tx.requestStatusHistory.create({
    data: {
      requestId,
      fromStatus: from as RequestStatus,
      toStatus: to as RequestStatus,
      changedByUserId: actorUserId,
      note: note ?? null,
    },
  });
}

/** Reads the fields every transition needs, or throws NOT_FOUND. */
export async function loadForTransition(tx: Tx, requestId: string) {
  const request = await tx.serviceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      customerId: true,
      assignedProviderId: true,
      acceptedOfferId: true,
      serviceTypeId: true,
    },
  });
  if (!request) throw new DomainError("NOT_FOUND");
  return { ...request, status: request.status as RequestStatusName };
}
