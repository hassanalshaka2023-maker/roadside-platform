import { z } from "zod";

import { GOVERNORATE_SLUGS } from "@/lib/geo";
import { VEHICLE_CATEGORIES } from "@/features/requests/schemas";

/**
 * Roles from the recruitment flyer. Passenger transport is deliberately
 * absent: it is deferred and not part of roadside assistance.
 */
export const PROVIDER_SPECIALTIES = [
  "auto-mechanic",
  "auto-electrician",
  "tire-repair",
  "tow-truck-driver",
] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const fileId = z.uuid().optional().or(z.literal("")).transform((v) => v || undefined);

/**
 * Saved as a draft at any point, so nothing here is required except what the
 * database needs. Completeness for SUBMISSION is `missingForSubmission`.
 */
export const applicationInputSchema = z.object({
  fullName: z.string().trim().min(3, "NAME_REQUIRED").max(100),
  providerKind: z.enum(["INDEPENDENT", "WORKSHOP"]),
  workshopName: optionalText(120),
  workshopAddress: optionalText(300),
  specialties: z.array(z.enum(PROVIDER_SPECIALTIES)).max(PROVIDER_SPECIALTIES.length),
  serviceTypes: z.array(z.string().regex(/^[a-z-]{2,40}$/)).max(10),
  yearsOfExperience: z.number().int().min(0).max(60).optional(),
  equipmentDescription: optionalText(1000),
  governorate: z.enum(GOVERNORATE_SLUGS, "GOVERNORATE_REQUIRED"),
  coverageAreas: z.array(z.string().trim().min(2).max(60)).max(10),
  baseLat: z.number().min(32).max(37.5).optional(),
  baseLng: z.number().min(35.5).max(42.5).optional(),
  availability: z.enum(["H24", "DAYTIME", "CUSTOM"]),
  availabilityNotes: optionalText(300),
  towVehicleType: optionalText(100),
  towVehiclePlate: optionalText(30),
  towCapacities: z.array(z.enum(VEHICLE_CATEGORIES)).max(VEHICLE_CATEGORIES.length),
  vehiclePhotoIds: z.array(z.uuid()).max(4),
  vehicleDocumentId: fileId,
  idDocumentFrontId: fileId,
  idDocumentBackId: fileId,
  selfieId: fileId,
  equipmentPhotoIds: z.array(z.uuid()).max(4),
  consentTerms: z.boolean(),
  consentAccuracy: z.boolean(),
  consentNoHiddenFees: z.boolean(),
});
export type ApplicationInput = z.infer<typeof applicationInputSchema>;

export type MissingField =
  | "specialties"
  | "serviceTypes"
  | "workshopName"
  | "baseLocation"
  | "idDocumentFront"
  | "selfie"
  | "towVehicleType"
  | "towVehiclePlate"
  | "towCapacities"
  | "vehiclePhotos"
  | "vehicleDocument"
  | "consentTerms"
  | "consentAccuracy"
  | "consentNoHiddenFees";

/** Towing is the one service with vehicle requirements. */
export const TOWING_SLUG = "towing";

/**
 * What still stops this application from being submitted. Pure, and the
 * same function runs in the browser (to guide) and on the server (to rule).
 */
export function missingForSubmission(input: ApplicationInput): MissingField[] {
  const missing: MissingField[] = [];
  if (input.specialties.length === 0) missing.push("specialties");
  if (input.serviceTypes.length === 0) missing.push("serviceTypes");
  if (input.providerKind === "WORKSHOP" && !input.workshopName) missing.push("workshopName");
  if (input.baseLat === undefined || input.baseLng === undefined) missing.push("baseLocation");
  if (!input.idDocumentFrontId) missing.push("idDocumentFront");
  if (!input.selfieId) missing.push("selfie");

  if (input.serviceTypes.includes(TOWING_SLUG)) {
    if (!input.towVehicleType) missing.push("towVehicleType");
    if (!input.towVehiclePlate) missing.push("towVehiclePlate");
    if (input.towCapacities.length === 0) missing.push("towCapacities");
    if (input.vehiclePhotoIds.length === 0) missing.push("vehiclePhotos");
    if (!input.vehicleDocumentId) missing.push("vehicleDocument");
  }

  if (!input.consentTerms) missing.push("consentTerms");
  if (!input.consentAccuracy) missing.push("consentAccuracy");
  if (!input.consentNoHiddenFees) missing.push("consentNoHiddenFees");
  return missing;
}

export const DECISIONS = ["APPROVED", "REJECTED", "NEEDS_INFO", "SUSPENDED"] as const;
export type Decision = (typeof DECISIONS)[number];

export type ApplicationStatusName =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "NEEDS_INFO"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

/** Which admin decisions are possible from each state. */
const DECISION_MAP: Record<ApplicationStatusName, readonly Decision[]> = {
  DRAFT: [],
  PENDING_REVIEW: ["APPROVED", "REJECTED", "NEEDS_INFO"],
  NEEDS_INFO: ["REJECTED"],
  APPROVED: ["SUSPENDED"],
  REJECTED: [],
  // Reinstating is an approval, with a reason like any other.
  SUSPENDED: ["APPROVED"],
};

export function allowedDecisions(from: ApplicationStatusName): readonly Decision[] {
  return DECISION_MAP[from];
}

/** A reason is mandatory for anything but a first approval. */
export function decisionNeedsReason(decision: Decision): boolean {
  return decision !== "APPROVED";
}

/** States in which the applicant may edit and (re)submit. */
export function applicantCanEdit(status: ApplicationStatusName | null): boolean {
  return status === null || status === "DRAFT" || status === "NEEDS_INFO" || status === "REJECTED";
}
