/**
 * Read side of jobs. Every function takes the viewer's id and filters by it
 * in the WHERE clause, so a guessed id returns nothing rather than someone
 * else's job.
 */
import "server-only";

import { prisma } from "@/lib/db";
import {
  ACTIVE_JOB_STATUSES,
  providerSeesContactDetails,
  type RequestStatusName,
} from "@/features/requests/state-machine";

export async function listExtras(requestId: string) {
  return prisma.extraCharge.findMany({
    where: { requestId },
    select: {
      id: true,
      description: true,
      laborSyp: true,
      partsSyp: true,
      totalSyp: true,
      status: true,
      createdAt: true,
      respondedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * A job as its booked provider sees it. The customer's name, phone and exact
 * location are included ONLY while the job is active; afterwards the
 * provider keeps the record of the work, not the customer's contact details.
 */
export async function getJobForProvider(providerUserId: string, requestId: string) {
  const job = await prisma.serviceRequest.findFirst({
    where: { id: requestId, assignedProviderId: providerUserId },
    select: {
      id: true,
      publicCode: true,
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
      destinationLat: true,
      destinationLng: true,
      etaAt: true,
      finalAmountSyp: true,
      providerConfirmedAt: true,
      customerConfirmedAt: true,
      disputeReason: true,
      commissionSyp: true,
      assignedAt: true,
      completedAt: true,
      createdAt: true,
      serviceType: { select: { nameAr: true, nameEn: true, slug: true, requiresDestination: true } },
      acceptedOffer: {
        select: {
          calloutFeeSyp: true,
          laborSyp: true,
          partsSyp: true,
          totalSyp: true,
          etaMinutes: true,
          includesText: true,
          excludesText: true,
          calloutDueIfDeclined: true,
        },
      },
      customer: { select: { name: true, phone: true, contactPhone: true } },
    },
  });
  if (!job) return null;

  const showContact = providerSeesContactDetails(job.status as RequestStatusName);
  return {
    ...job,
    // Stripped outside an active job, so the page cannot leak them by mistake.
    lat: showContact ? job.lat : null,
    lng: showContact ? job.lng : null,
    addressText: showContact ? job.addressText : null,
    landmarkText: showContact ? job.landmarkText : null,
    plateNumber: showContact ? job.plateNumber : null,
    photoIds: showContact ? job.photoIds : [],
    customer: showContact ? job.customer : null,
    showContact,
  };
}

export async function listProviderJobs(providerUserId: string, which: "active" | "history", limit = 50) {
  return prisma.serviceRequest.findMany({
    where: {
      assignedProviderId: providerUserId,
      status: which === "active" ? { in: [...ACTIVE_JOB_STATUSES, "DISPUTED"] } : { notIn: [...ACTIVE_JOB_STATUSES, "DISPUTED"] },
    },
    select: {
      id: true,
      publicCode: true,
      status: true,
      governorate: true,
      finalAmountSyp: true,
      commissionSyp: true,
      etaAt: true,
      createdAt: true,
      completedAt: true,
      serviceType: { select: { nameAr: true, nameEn: true } },
      rating: { select: { stars: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function listMyPendingOffers(providerUserId: string) {
  return prisma.requestOffer.findMany({
    where: { providerId: providerUserId, status: "PENDING", validUntil: { gt: new Date() } },
    select: {
      id: true,
      totalSyp: true,
      validUntil: true,
      request: {
        select: { id: true, publicCode: true, governorate: true, serviceType: { select: { nameAr: true, nameEn: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Photos of a request are visible to its booked provider during the job.
 * Used by the file route in addition to the owner/admin rule.
 */
export async function isActiveJobPhoto(providerUserId: string, fileId: string): Promise<boolean> {
  const count = await prisma.serviceRequest.count({
    where: {
      assignedProviderId: providerUserId,
      status: { in: [...ACTIVE_JOB_STATUSES] },
      photoIds: { has: fileId },
    },
  });
  return count > 0;
}
