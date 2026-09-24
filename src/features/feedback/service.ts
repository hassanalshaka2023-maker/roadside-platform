/**
 * Ratings and complaints.
 *
 * A rating exists only for a COMPLETED request, once, by its customer. The
 * provider's average is recomputed from the Rating table in the same
 * transaction - never incremented blindly - so it is always the true average
 * of real ratings.
 */
import "server-only";

import { Prisma, type ComplaintStatus } from "@prisma/client";

import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { DomainError } from "@/features/requests/errors";
import { isActiveJob, type RequestStatusName } from "@/features/requests/state-machine";

export async function rateProvider(params: {
  customerId: string;
  requestId: string;
  stars: number;
  comment?: string;
  ip?: string | null;
}): Promise<void> {
  const { customerId, requestId, stars, comment, ip } = params;

  try {
    await prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.findUnique({
        where: { id: requestId },
        select: { customerId: true, status: true, assignedProviderId: true },
      });
      if (!request || request.customerId !== customerId) throw new DomainError("NOT_FOUND");
      if (request.status !== "COMPLETED" || !request.assignedProviderId) {
        throw new DomainError("NOT_RATEABLE");
      }

      await tx.rating.create({
        data: {
          requestId,
          customerId,
          providerId: request.assignedProviderId,
          stars,
          comment: comment || null,
        },
      });

      const agg = await tx.rating.aggregate({
        where: { providerId: request.assignedProviderId },
        _avg: { stars: true },
        _count: { _all: true },
      });
      await tx.providerProfile.update({
        where: { userId: request.assignedProviderId },
        data: {
          ratingAverage: Math.round((agg._avg.stars ?? 0) * 10) / 10,
          ratingCount: agg._count._all,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DomainError("ALREADY_RATED");
    }
    throw error;
  }

  await audit({
    actorId: customerId,
    action: "rating.created",
    entityType: "ServiceRequest",
    entityId: requestId,
    metadata: { stars },
    ip,
  });
}

export const COMPLAINT_CATEGORIES = [
  "PRICE",
  "BEHAVIOUR",
  "QUALITY",
  "NO_SHOW",
  "DELAY",
  "SAFETY",
  "OTHER",
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

/**
 * Filed by the customer, or by the provider booked on the request. Anyone
 * else gets NOT_FOUND - the same answer as for a request that does not exist.
 */
export async function fileComplaint(params: {
  userId: string;
  requestId: string;
  category: ComplaintCategory;
  description: string;
  ip?: string | null;
}): Promise<{ complaintId: string }> {
  const { userId, requestId, category, description, ip } = params;

  const request = await prisma.serviceRequest.findUnique({
    where: { id: requestId },
    select: { customerId: true, assignedProviderId: true, status: true },
  });
  const isParty =
    request !== null &&
    (request.customerId === userId || request.assignedProviderId === userId);
  if (!isParty) throw new DomainError("NOT_FOUND");

  const open = await prisma.complaint.count({
    where: { requestId, filedById: userId, status: { in: ["OPEN", "IN_REVIEW"] } },
  });
  // One open complaint per person per request is plenty; stops accidental
  // double submission on a slow connection.
  if (open >= 1) {
    const existing = await prisma.complaint.findFirstOrThrow({
      where: { requestId, filedById: userId, status: { in: ["OPEN", "IN_REVIEW"] } },
      select: { id: true },
    });
    return { complaintId: existing.id };
  }

  const complaint = await prisma.complaint.create({
    data: { requestId, filedById: userId, category, description },
    select: { id: true },
  });

  await audit({
    actorId: userId,
    action: "complaint.created",
    entityType: "Complaint",
    entityId: complaint.id,
    metadata: { requestId, category, requestStatus: request!.status, activeJob: isActiveJob(request!.status as RequestStatusName) },
    ip,
  });

  return { complaintId: complaint.id };
}

export async function updateComplaint(params: {
  adminId: string;
  complaintId: string;
  status: ComplaintStatus;
  adminNote?: string;
  ip?: string | null;
}): Promise<void> {
  const { adminId, complaintId, status, adminNote, ip } = params;
  const closing = status === "RESOLVED" || status === "REJECTED";

  const updated = await prisma.complaint.updateMany({
    where: { id: complaintId },
    data: {
      status,
      adminNote: adminNote || undefined,
      resolvedById: closing ? adminId : null,
      resolvedAt: closing ? new Date() : null,
    },
  });
  if (updated.count === 0) throw new DomainError("NOT_FOUND");

  await audit({
    actorId: adminId,
    action: "complaint.updated",
    entityType: "Complaint",
    entityId: complaintId,
    metadata: { status },
    ip,
  });
}
