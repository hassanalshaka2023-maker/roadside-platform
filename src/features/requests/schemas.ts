import { z } from "zod";

/**
 * Input schemas for the request wizard.
 *
 * One schema per step, plus a combined one for the final submit. The steps
 * are validated on the client for immediate feedback AND on the server at
 * submit time - the client copy is a convenience, the server copy is the rule.
 *
 * Messages are error CODES, resolved to Arabic through messages/*.json.
 */

/** Roughly the bounding box of Syria, with a margin for border areas. */
const SYRIA_BOUNDS = {
  minLat: 32.0,
  maxLat: 37.5,
  minLng: 35.5,
  maxLng: 42.5,
} as const;

export const coordinatesSchema = z.object({
  lat: z
    .number()
    .min(SYRIA_BOUNDS.minLat, "OUT_OF_COVERAGE")
    .max(SYRIA_BOUNDS.maxLat, "OUT_OF_COVERAGE"),
  lng: z
    .number()
    .min(SYRIA_BOUNDS.minLng, "OUT_OF_COVERAGE")
    .max(SYRIA_BOUNDS.maxLng, "OUT_OF_COVERAGE"),
});

export function isWithinCoverage(lat: number, lng: number): boolean {
  return coordinatesSchema.safeParse({ lat, lng }).success;
}

// --- step 1: what is wrong -------------------------------------------------

export const serviceTypeStepSchema = z.object({
  serviceTypeId: z.uuid("SERVICE_TYPE_REQUIRED"),
});

// --- step 2: where ---------------------------------------------------------

export const locationStepSchema = coordinatesSchema.extend({
  addressText: z.string().trim().max(300).optional().or(z.literal("")),
  /**
   * Landmarks matter more than street names here - "opposite the mosque" is
   * how a driver is actually guided in most Syrian neighbourhoods.
   */
  landmarkText: z.string().trim().max(300).optional().or(z.literal("")),
});

// --- step 3: the car -------------------------------------------------------

const currentYear = new Date().getFullYear();

export const carStepSchema = z.object({
  carMake: z.string().trim().max(60).optional().or(z.literal("")),
  carModel: z.string().trim().max(60).optional().or(z.literal("")),
  carYear: z.coerce
    .number()
    .int()
    .min(1950, "CAR_YEAR_RANGE")
    // Next year's models go on sale this year.
    .max(currentYear + 1, "CAR_YEAR_RANGE")
    .optional(),
  plateNumber: z.string().trim().max(30).optional().or(z.literal("")),
  problemDescription: z.string().trim().max(1000).optional().or(z.literal("")),
});

// --- final submit ----------------------------------------------------------

/** UUIDs of files already uploaded through /api/files. */
const fileIdList = z
  .array(z.uuid())
  .max(6, "TOO_MANY_PHOTOS")
  .optional()
  .default([]);

export const createRequestSchema = serviceTypeStepSchema
  .extend(locationStepSchema.shape)
  .extend(carStepSchema.shape)
  .extend({
    photoIds: fileIdList,
    /** Set when settings require an ID for this request. */
    idFrontFileId: z.uuid().optional(),
    idConsentAccepted: z.boolean().optional(),
  });

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type LocationStepInput = z.infer<typeof locationStepSchema>;
export type CarStepInput = z.infer<typeof carStepSchema>;

export const cancelRequestSchema = z.object({
  requestId: z.uuid(),
  reason: z.string().trim().max(300).optional().or(z.literal("")),
});

/** A tracking token is 32 random bytes, base64url encoded. */
export const trackingTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{20,128}$/, "INVALID_TOKEN");

export function isValidTrackingToken(value: string): boolean {
  return trackingTokenSchema.safeParse(value).success;
}
