/**
 * An approved provider's own settings, and the admin edits to a provider.
 *
 * What a provider may change about themselves is deliberately narrow:
 * availability, reach, hours and base location. WHAT they are approved to do
 * (their services) is an admin decision, audited like the approval itself.
 */
import "server-only";

import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { DomainError } from "@/features/requests/errors";

export async function getOwnProfile(userId: string) {
  return prisma.providerProfile.findUnique({
    where: { userId },
    select: {
      status: true,
      isAvailable: true,
      serviceRadiusKm: true,
      workingHours: true,
      coverageAreas: true,
      governorate: true,
      currentLat: true,
      currentLng: true,
      ratingAverage: true,
      ratingCount: true,
      completedJobs: true,
      serviceTypeIds: true,
      workshopName: true,
      providerKind: true,
      towCapacities: true,
    },
  });
}

export async function setAvailability(userId: string, available: boolean): Promise<void> {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId },
    select: { status: true, currentLat: true },
  });
  if (!profile) throw new DomainError("NOT_FOUND");
  if (available && profile.status !== "ACTIVE") throw new DomainError("NOT_ELIGIBLE");
  if (available && profile.currentLat === null) throw new DomainError("NOT_ELIGIBLE", "no base location");

  await prisma.providerProfile.update({ where: { userId }, data: { isAvailable: available } });
}

export async function updateOwnProfile(params: {
  userId: string;
  serviceRadiusKm: number;
  workingHours: string;
  coverageAreas: string[];
  lat?: number;
  lng?: number;
  ip?: string | null;
}): Promise<void> {
  const { userId, ip } = params;
  const updated = await prisma.providerProfile.updateMany({
    where: { userId },
    data: {
      serviceRadiusKm: params.serviceRadiusKm,
      workingHours: params.workingHours || null,
      coverageAreas: params.coverageAreas,
      ...(params.lat !== undefined && params.lng !== undefined
        ? { currentLat: params.lat, currentLng: params.lng, locationUpdatedAt: new Date() }
        : {}),
    },
  });
  if (updated.count === 0) throw new DomainError("NOT_FOUND");

  await audit({
    actorId: userId,
    action: "provider.updated",
    entityType: "ProviderProfile",
    entityId: userId,
    metadata: { serviceRadiusKm: params.serviceRadiusKm, movedBase: params.lat !== undefined },
    ip,
  });
}

/** Admin: which services an approved provider may offer. */
export async function setProviderServices(params: {
  adminId: string;
  providerUserId: string;
  serviceTypeIds: string[];
  ip?: string | null;
}): Promise<void> {
  const valid = await prisma.serviceType.findMany({
    where: { id: { in: params.serviceTypeIds } },
    select: { id: true },
  });
  const before = await prisma.providerProfile.findUnique({
    where: { userId: params.providerUserId },
    select: { serviceTypeIds: true },
  });
  if (!before) throw new DomainError("NOT_FOUND");

  await prisma.providerProfile.update({
    where: { userId: params.providerUserId },
    data: { serviceTypeIds: valid.map((s) => s.id) },
  });

  await audit({
    actorId: params.adminId,
    action: "provider.updated",
    entityType: "ProviderProfile",
    entityId: params.providerUserId,
    metadata: { before: before.serviceTypeIds, after: valid.map((s) => s.id) },
    ip: params.ip,
  });
}

/** Admin: suspend or reactivate a user account (customer or provider). */
export async function setUserStatus(params: {
  adminId: string;
  userId: string;
  status: "ACTIVE" | "SUSPENDED";
  reason: string;
  ip?: string | null;
}): Promise<void> {
  const target = await prisma.user.findUnique({ where: { id: params.userId }, select: { role: true, status: true } });
  if (!target) throw new DomainError("NOT_FOUND");
  // Admin accounts are managed from the seed/CLI, never from this screen.
  if (target.role === "ADMIN") throw new DomainError("NOT_ELIGIBLE");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: params.userId }, data: { status: params.status } });
    if (params.status === "SUSPENDED") {
      // Signed out everywhere at once.
      await tx.session.updateMany({ where: { userId: params.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.providerProfile.updateMany({ where: { userId: params.userId }, data: { isAvailable: false } });
      await tx.requestOffer.updateMany({
        where: { providerId: params.userId, status: "PENDING" },
        data: { status: "WITHDRAWN", respondedAt: new Date() },
      });
    }
  });

  await audit({
    actorId: params.adminId,
    action: "user.status.changed",
    entityType: "User",
    entityId: params.userId,
    metadata: { from: target.status, to: params.status, reason: params.reason },
    ip: params.ip,
  });
}
