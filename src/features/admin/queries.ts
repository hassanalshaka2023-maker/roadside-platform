/**
 * Read side of the admin panel. Callers check permissions first; these
 * functions just fetch.
 */
import "server-only";

import type { ApplicationStatus, ComplaintStatus, Prisma, RequestStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { distanceKm } from "@/lib/geo";
import { ACTIVE_JOB_STATUSES } from "@/features/requests/state-machine";

const PAGE = 50;

export async function listRequests(filters: { status?: RequestStatus; q?: string }) {
  const where: Prisma.ServiceRequestWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { publicCode: { contains: q.toUpperCase() } },
      { customer: { phone: { contains: q.replace(/^0/, "") } } },
      { customer: { contactPhone: { contains: q.replace(/^0/, "") } } },
      { customer: { email: { contains: q.toLowerCase() } } },
    ];
  }
  return prisma.serviceRequest.findMany({
    where,
    select: {
      id: true,
      publicCode: true,
      status: true,
      governorate: true,
      createdAt: true,
      finalAmountSyp: true,
      serviceType: { select: { nameAr: true, nameEn: true } },
      customer: { select: { name: true, phone: true, contactPhone: true, email: true } },
      assignedProvider: { select: { name: true } },
      _count: { select: { offers: { where: { status: "PENDING" } } } },
    },
    orderBy: { createdAt: "desc" },
    take: PAGE,
  });
}

export async function getRequestAdmin(id: string) {
  return prisma.serviceRequest.findUnique({
    where: { id },
    include: {
      serviceType: true,
      customer: { select: { id: true, name: true, phone: true, contactPhone: true, email: true, status: true } },
      assignedProvider: { select: { id: true, name: true, phone: true, contactPhone: true } },
      offers: {
        include: { provider: { select: { name: true, phone: true, contactPhone: true } } },
        orderBy: { createdAt: "desc" },
      },
      extraCharges: { orderBy: { createdAt: "asc" } },
      statusHistory: {
        include: { changedBy: { select: { name: true, email: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
      complaints: { orderBy: { createdAt: "desc" } },
      invites: { include: { provider: { select: { name: true } } } },
      commissionEntry: true,
      rating: true,
    },
  });
}

/**
 * Approved providers who could take this request, nearest first - including
 * those who are offline or out of range, flagged, because the point of a
 * manual invitation is to reach beyond the automatic match.
 */
export async function candidateProvidersForRequest(request: { serviceTypeId: string; lat: number; lng: number; customerId: string }) {
  const profiles = await prisma.providerProfile.findMany({
    where: {
      status: "ACTIVE",
      serviceTypeIds: { has: request.serviceTypeId },
      userId: { not: request.customerId },
      user: { status: "ACTIVE" },
    },
    select: {
      userId: true,
      isAvailable: true,
      currentLat: true,
      currentLng: true,
      serviceRadiusKm: true,
      ratingAverage: true,
      ratingCount: true,
      user: { select: { name: true, phone: true, contactPhone: true } },
    },
    take: 200,
  });

  const busy = new Set(
    (
      await prisma.serviceRequest.findMany({
        where: { assignedProviderId: { in: profiles.map((p) => p.userId) }, status: { in: [...ACTIVE_JOB_STATUSES] } },
        select: { assignedProviderId: true },
      })
    ).map((r) => r.assignedProviderId),
  );

  return profiles
    .map((p) => ({
      ...p,
      busy: busy.has(p.userId),
      distanceKm:
        p.currentLat !== null && p.currentLng !== null
          ? Math.round(distanceKm({ lat: p.currentLat, lng: p.currentLng }, request))
          : null,
    }))
    .sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999))
    .slice(0, 20);
}

export async function listApplications(status?: ApplicationStatus) {
  return prisma.providerApplication.findMany({
    where: status ? { status } : { status: { not: "DRAFT" } },
    select: {
      id: true,
      publicReference: true,
      fullName: true,
      phone: true,
      governorate: true,
      serviceTypes: true,
      status: true,
      submittedAt: true,
      createdAt: true,
    },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    take: PAGE,
  });
}

export async function getApplicationAdmin(id: string) {
  return prisma.providerApplication.findUnique({
    where: { id },
    include: {
      decisions: {
        include: { admin: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      },
      user: { select: { id: true, role: true, status: true } },
    },
  });
}

export async function listProviders() {
  return prisma.providerProfile.findMany({
    select: {
      userId: true,
      status: true,
      isAvailable: true,
      governorate: true,
      ratingAverage: true,
      ratingCount: true,
      completedJobs: true,
      applicationId: true,
      user: { select: { name: true, phone: true, contactPhone: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getProviderAdmin(userId: string) {
  return prisma.providerProfile.findUnique({
    where: { userId },
    include: {
      user: { select: { id: true, name: true, phone: true, contactPhone: true, email: true, status: true, createdAt: true } },
      application: { select: { id: true, publicReference: true, status: true } },
    },
  });
}

export async function listCustomers(q?: string) {
  return prisma.user.findMany({
    where: {
      role: { in: ["CUSTOMER", "PROVIDER"] },
      ...(q
        ? {
            OR: [
              { phone: { contains: q.replace(/^0/, "") } },
              { contactPhone: { contains: q.replace(/^0/, "") } },
              { email: { contains: q.toLowerCase() } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      contactPhone: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      _count: { select: { requestsAsCustomer: true } },
    },
    orderBy: { createdAt: "desc" },
    take: PAGE,
  });
}

export async function listComplaints(status?: ComplaintStatus) {
  return prisma.complaint.findMany({
    where: status ? { status } : {},
    include: {
      request: { select: { id: true, publicCode: true } },
      filedBy: { select: { name: true, phone: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: PAGE,
  });
}

export async function listAudit(filters: { action?: string }) {
  return prisma.auditLog.findMany({
    where: filters.action ? { action: { startsWith: filters.action } } : {},
    include: { actor: { select: { name: true, email: true, phone: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
