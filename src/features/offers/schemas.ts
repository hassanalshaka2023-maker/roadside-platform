import { z } from "zod";

import { MAX_AMOUNT_SYP } from "@/lib/money";

/** A whole number of pounds. Forms send strings; parsing happens before. */
const amount = z.number().int("INVALID_AMOUNT").min(0, "INVALID_AMOUNT").max(MAX_AMOUNT_SYP, "INVALID_AMOUNT");

export const offerInputSchema = z
  .object({
    requestId: z.uuid(),
    calloutFeeSyp: amount,
    laborSyp: amount,
    partsSyp: amount,
    etaMinutes: z.number().int().min(1, "INVALID_ETA").max(1440, "INVALID_ETA"),
    includesText: z.string().trim().max(500).optional().or(z.literal("")),
    excludesText: z.string().trim().max(500).optional().or(z.literal("")),
    calloutDueIfDeclined: z.boolean(),
  })
  .refine((o) => o.calloutFeeSyp + o.laborSyp + o.partsSyp > 0, {
    message: "INVALID_AMOUNT",
    path: ["calloutFeeSyp"],
  });
export type OfferInput = z.infer<typeof offerInputSchema>;

export const acceptOfferSchema = z.object({
  requestId: z.uuid(),
  offerId: z.uuid(),
  /** The customer ticked "I understand the callout fee terms". */
  feeTermsAccepted: z.literal(true, "FEE_TERMS_REQUIRED"),
});

export const extraChargeInputSchema = z
  .object({
    requestId: z.uuid(),
    description: z.string().trim().min(3, "DESCRIPTION_REQUIRED").max(500),
    laborSyp: amount,
    partsSyp: amount,
  })
  .refine((e) => e.laborSyp + e.partsSyp > 0, { message: "INVALID_AMOUNT", path: ["laborSyp"] });
export type ExtraChargeInput = z.infer<typeof extraChargeInputSchema>;
