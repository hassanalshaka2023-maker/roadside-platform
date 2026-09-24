/**
 * Provider applications and their review.
 *
 * Filling in the form proves nothing: an applicant stays a CUSTOMER, sees no
 * requests and can send no offers until an admin APPROVES the application.
 * Approval is what creates the ProviderProfile that matching looks at.
 */
import "server-only";

import type { FileKind, Prisma } from "@prisma/client";

import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { attachFiles, ownsAttachableFiles } from "@/lib/files/service";
import { loggerFor } from "@/lib/logger";
import { DomainError } from "@/features/requests/errors";
import {
  allowedDecisions,
  applicantCanEdit,
  decisionNeedsReason,
  missingForSubmission,
  type ApplicationInput,
  type ApplicationStatusName,
  type Decision,
} from "./schemas";

const log = loggerFor("applications/service");

export async function getOwnApplication(userId: string) {
  return prisma.providerApplication.findUnique({
    where: { userId },
    select: {
      id: true,
      status: true,
      publicReference: true,
      decisionReason: true,
      submittedAt: true,
      reviewedAt: true,
      fullName: true,
      providerKind: true,
      workshopName: true,
      workshopAddress: true,
      specialties: true,
      serviceTypes: true,
      yearsOfExperience: true,
      equipmentDescription: true,
      governorate: true,
      coverageAreas: true,
      baseLat: true,
      baseLng: true,
      availability: true,
      availabilityNotes: true,
      towVehicleType: true,
      towVehiclePlate: true,
      towCapacities: true,
      vehiclePhotoIds: true,
      vehicleDocumentId: true,
      idDocumentFrontId: true,
      idDocumentBackId: true,
      selfieId: true,
      equipmentPhotoIds: true,
      consentTerms: true,
      consentAccuracy: true,
      consentNoHiddenFees: true,
    },
  });
}

/** Every file id the input references, with the kind it must be. */
function referencedFiles(input: ApplicationInput): Array<{ id: string; kind: FileKind }> {
  const files: Array<{ id: string; kind: FileKind }> = [];
  if (input.idDocumentFrontId) files.push({ id: input.idDocumentFrontId, kind: "ID_FRONT" });
  if (input.idDocumentBackId) files.push({ id: input.idDocumentBackId, kind: "ID_BACK" });
  if (input.selfieId) files.push({ id: input.selfieId, kind: "SELFIE" });
  if (input.vehicleDocumentId) files.push({ id: input.vehicleDocumentId, kind: "VEHICLE_DOCUMENT" });
  for (const id of input.vehiclePhotoIds) files.push({ id, kind: "VEHICLE_PHOTO" });
  for (const id of input.equipmentPhotoIds) files.push({ id, kind: "EQUIPMENT_PHOTO" });
  return files;
}

function fileIdsOf(app: {
  idDocumentFrontId: string | null;
  idDocumentBackId: string | null;
  selfieId: string | null;
  vehicleDocumentId: string | null;
  vehiclePhotoIds: string[];
  equipmentPhotoIds: string[];
}): Set<string> {
  return new Set(
    [
      app.idDocumentFrontId,
      app.idDocumentBackId,
      app.selfieId,
      app.vehicleDocumentId,
      ...app.vehiclePhotoIds,
      ...app.equipmentPhotoIds,
    ].filter((id): id is string => Boolean(id)),
  );
}

/**
 * Saves the applicant's form, as a draft or as a submission.
 *
 * Files already on the application may stay; any NEW file id must be an
 * unattached upload of the right kind owned by this user - so nobody can
 * link someone else's ID scan to their own application.
 */
export async function saveApplication(params: {
  userId: string;
  phone: string;
  input: ApplicationInput;
  submit: boolean;
  ip?: string | null;
}): Promise<{ status: ApplicationStatusName; publicReference: string }> {
  const { userId, phone, input, submit, ip } = params;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
  if (user.role === "ADMIN") throw new DomainError("PROVIDER_ROLE_CONFLICT");

  if (submit) {
    const missing = missingForSubmission(input);
    if (missing.length > 0) throw new DomainError("APPLICATION_INCOMPLETE", missing.join(","));
  }

  // Only real, active service slugs survive.
  const validServices = await prisma.serviceType.findMany({
    where: { slug: { in: input.serviceTypes }, isActive: true },
    select: { slug: true },
  });
  const serviceTypes = validServices.map((s) => s.slug);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.providerApplication.findUnique({
      where: { userId },
      select: {
        id: true,
        status: true,
        idDocumentFrontId: true,
        idDocumentBackId: true,
        selfieId: true,
        vehicleDocumentId: true,
        vehiclePhotoIds: true,
        equipmentPhotoIds: true,
      },
    });

    if (!applicantCanEdit(existing?.status ?? null)) throw new DomainError("APPLICATION_LOCKED");

    const known = existing ? fileIdsOf(existing) : new Set<string>();
    const newFiles = referencedFiles(input).filter((file) => !known.has(file.id));
    for (const kind of new Set(newFiles.map((f) => f.kind))) {
      const ids = newFiles.filter((f) => f.kind === kind).map((f) => f.id);
      if (!(await ownsAttachableFiles(ids, userId, [kind], tx))) {
        throw new DomainError("NOT_FOUND", "attached file");
      }
    }

    const now = new Date();
    const status: ApplicationStatusName = submit ? "PENDING_REVIEW" : (existing?.status ?? "DRAFT") === "DRAFT" ? "DRAFT" : (existing!.status as ApplicationStatusName);

    const data = {
      fullName: input.fullName,
      phone,
      providerKind: input.providerKind,
      workshopName: input.providerKind === "WORKSHOP" ? input.workshopName || null : null,
      workshopAddress: input.providerKind === "WORKSHOP" ? input.workshopAddress || null : null,
      specialties: input.specialties,
      serviceTypes,
      yearsOfExperience: input.yearsOfExperience ?? null,
      hasVehicleOrEquipment: Boolean(input.equipmentDescription || input.towVehicleType),
      equipmentDescription: input.equipmentDescription || null,
      governorate: input.governorate,
      coverageAreas: input.coverageAreas,
      baseLat: input.baseLat ?? null,
      baseLng: input.baseLng ?? null,
      availability: input.availability,
      availabilityNotes: input.availabilityNotes || null,
      towVehicleType: input.towVehicleType || null,
      towVehiclePlate: input.towVehiclePlate || null,
      towCapacities: input.towCapacities,
      vehiclePhotoIds: input.vehiclePhotoIds,
      vehicleDocumentId: input.vehicleDocumentId ?? null,
      idDocumentFrontId: input.idDocumentFrontId ?? null,
      idDocumentBackId: input.idDocumentBackId ?? null,
      selfieId: input.selfieId ?? null,
      equipmentPhotoIds: input.equipmentPhotoIds,
      consentTerms: input.consentTerms,
      consentAccuracy: input.consentAccuracy,
      consentNoHiddenFees: input.consentNoHiddenFees,
      consentAcceptedAt:
        input.consentTerms && input.consentAccuracy && input.consentNoHiddenFees ? now : null,
      status,
      submittedAt: submit ? now : undefined,
    } satisfies Prisma.ProviderApplicationUncheckedUpdateInput;

    const saved = existing
      ? await tx.providerApplication.update({
          where: { id: existing.id },
          data,
          select: { id: true, publicReference: true, status: true },
        })
      : await tx.providerApplication.create({
          data: { ...data, userId },
          select: { id: true, publicReference: true, status: true },
        });

    await attachFiles(newFiles.map((f) => f.id), tx);

    if (submit && existing && existing.status !== "DRAFT") {
      // A resubmission after NEEDS_INFO or REJECTED is part of the history.
      await tx.applicationDecision.create({
        data: {
          applicationId: saved.id,
          adminId: null,
          fromStatus: existing.status,
          toStatus: "PENDING_REVIEW",
          reason: "resubmitted by applicant",
        },
      });
    }

    return { id: saved.id, status: saved.status as ApplicationStatusName, publicReference: saved.publicReference };
  });

  await audit({
    actorId: userId,
    action: submit ? "application.submitted" : "application.saved",
    entityType: "ProviderApplication",
    entityId: result.id,
    metadata: { status: result.status },
    ip,
  });

  return { status: result.status, publicReference: result.publicReference };
}

/**
 * An admin decision, always with its reason recorded and audited.
 *
 * APPROVED -> the account becomes a PROVIDER with an ACTIVE profile (offline
 * until they switch themselves on). SUSPENDED -> the profile stops matching
 * at once, and any live offers are withdrawn.
 */
export async function decideApplication(params: {
  adminId: string;
  applicationId: string;
  decision: Decision;
  reason?: string;
  ip?: string | null;
}): Promise<void> {
  const { adminId, applicationId, decision, ip } = params;
  const reason = params.reason?.trim() || null;

  if (decisionNeedsReason(decision) && !reason) {
    throw new DomainError("INVALID_DECISION", "reason required");
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const app = await tx.providerApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        status: true,
        userId: true,
        serviceTypes: true,
        providerKind: true,
        workshopName: true,
        governorate: true,
        coverageAreas: true,
        baseLat: true,
        baseLng: true,
        towCapacities: true,
        availabilityNotes: true,
        user: { select: { role: true } },
      },
    });
    if (!app) throw new DomainError("NOT_FOUND");

    const from = app.status as ApplicationStatusName;
    if (!allowedDecisions(from).includes(decision)) {
      throw new DomainError("INVALID_DECISION", `${from} -> ${decision}`);
    }

    const updated = await tx.providerApplication.updateMany({
      where: { id: app.id, status: app.status },
      data: {
        status: decision,
        decisionReason: reason,
        reviewedByAdminId: adminId,
        reviewedAt: new Date(),
      },
    });
    if (updated.count === 0) throw new DomainError("CONCURRENT_UPDATE");

    await tx.applicationDecision.create({
      data: { applicationId: app.id, adminId, fromStatus: app.status, toStatus: decision, reason },
    });

    if (decision === "APPROVED") {
      if (app.user.role === "ADMIN") throw new DomainError("PROVIDER_ROLE_CONFLICT");

      const services = await tx.serviceType.findMany({
        where: { slug: { in: app.serviceTypes } },
        select: { id: true },
      });

      const profileData = {
        applicationId: app.id,
        providerKind: app.providerKind,
        workshopName: app.workshopName,
        serviceTypeIds: services.map((s) => s.id),
        governorate: app.governorate,
        coverageAreas: app.coverageAreas,
        towCapacities: app.towCapacities,
        workingHours: app.availabilityNotes,
        currentLat: app.baseLat,
        currentLng: app.baseLng,
        locationUpdatedAt: new Date(),
        status: "ACTIVE" as const,
      };

      await tx.providerProfile.upsert({
        where: { userId: app.userId },
        create: { userId: app.userId, ...profileData, isAvailable: false },
        update: profileData,
      });
      await tx.user.update({ where: { id: app.userId }, data: { role: "PROVIDER" } });
    }

    if (decision === "SUSPENDED") {
      await tx.providerProfile.updateMany({
        where: { userId: app.userId },
        data: { status: "SUSPENDED", isAvailable: false },
      });
      await tx.requestOffer.updateMany({
        where: { providerId: app.userId, status: "PENDING" },
        data: { status: "WITHDRAWN", respondedAt: new Date() },
      });
    }

    const activeJobs =
      decision === "SUSPENDED"
        ? await tx.serviceRequest.count({
            where: {
              assignedProviderId: app.userId,
              status: { in: ["CONFIRMED", "ON_THE_WAY", "ARRIVED", "IN_PROGRESS", "AWAITING_CONFIRMATION"] },
            },
          })
        : 0;

    return { from, userId: app.userId, activeJobs };
  });

  log.info({ applicationId, decision }, "application decided");

  await audit({
    actorId: adminId,
    action: "application.decision",
    entityType: "ProviderApplication",
    entityId: applicationId,
    metadata: { from: outcome.from, to: decision, reason, providerUserId: outcome.userId, activeJobs: outcome.activeJobs },
    ip,
  });
}
