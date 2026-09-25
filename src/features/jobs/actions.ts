"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { formAmount, formBool, formInt, formString, runAction, type ActionResult } from "@/lib/action-result";
import { extraChargeInputSchema, offerInputSchema } from "@/features/offers/schemas";
import { submitOffer, withdrawOffer } from "@/features/offers/service";
import { setAvailability, updateOwnProfile } from "@/features/providers/service";
import {
  advanceJob,
  markJobDone,
  proposeExtraCharge,
  providerWithdraw,
  reopenJob,
  updateEta,
  withdrawExtraCharge,
} from "./service";

const uuid = z.uuid();
const requestIdOf = (formData: FormData) => uuid.parse(formString(formData, "requestId"));
const etaSchema = z.number().int().min(1, "INVALID_ETA").max(1440, "INVALID_ETA");

export async function setAvailabilityAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateOwnAvailability", async ({ user }) => {
    await setAvailability(user.id, formString(formData, "available") === "true");
    refresh();
    return undefined;
  });
}

export async function submitOfferAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "sendOffers",
    async ({ user, ip }) => {
      const input = offerInputSchema.parse({
        requestId: formString(formData, "requestId"),
        calloutFeeSyp: formAmount(formData, "calloutFeeSyp"),
        laborSyp: formAmount(formData, "laborSyp"),
        partsSyp: formAmount(formData, "partsSyp"),
        etaMinutes: formInt(formData, "etaMinutes"),
        includesText: formString(formData, "includesText"),
        excludesText: formString(formData, "excludesText"),
        calloutDueIfDeclined: formBool(formData, "calloutDueIfDeclined"),
      });
      await submitOffer({ providerUserId: user.id, input, ip });
      refresh();
      return undefined;
    },
    { rateLimit: "offerPerUser" },
  );
}

export async function withdrawOfferAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "sendOffers",
    async ({ user, ip }) => {
      await withdrawOffer({ providerUserId: user.id, offerId: uuid.parse(formString(formData, "offerId")), ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function advanceJobAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "updateJobStatus",
    async ({ user, ip }) => {
      const to = z.enum(["ON_THE_WAY", "ARRIVED", "IN_PROGRESS"]).parse(formString(formData, "to"));
      const eta = formInt(formData, "etaMinutes");
      await advanceJob({
        providerUserId: user.id,
        requestId: requestIdOf(formData),
        to,
        etaMinutes: eta === undefined ? undefined : etaSchema.parse(eta),
        ip,
      });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function updateEtaAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "updateJobStatus",
    async ({ user }) => {
      await updateEta({
        providerUserId: user.id,
        requestId: requestIdOf(formData),
        etaMinutes: etaSchema.parse(formInt(formData, "etaMinutes")),
      });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function proposeExtraAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "updateJobStatus",
    async ({ user, ip }) => {
      const input = extraChargeInputSchema.parse({
        requestId: formString(formData, "requestId"),
        description: formString(formData, "description"),
        laborSyp: formAmount(formData, "laborSyp"),
        partsSyp: formAmount(formData, "partsSyp"),
      });
      await proposeExtraCharge({ providerUserId: user.id, input, ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function withdrawExtraAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "updateJobStatus",
    async ({ user, ip }) => {
      await withdrawExtraCharge({ providerUserId: user.id, extraId: uuid.parse(formString(formData, "extraId")), ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function markDoneAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "updateJobStatus",
    async ({ user, ip }) => {
      const outcome = z.enum(["WORK_DONE", "CALLOUT_ONLY"]).parse(formString(formData, "outcome"));
      if (!formBool(formData, "cashReceived")) {
        throw new z.ZodError([{ code: "custom", path: ["cashReceived"], message: "PAYMENT_CONFIRMATION_REQUIRED", input: undefined }]);
      }
      await markJobDone({ providerUserId: user.id, requestId: requestIdOf(formData), outcome, ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function reopenJobAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "updateJobStatus",
    async ({ user, ip }) => {
      await reopenJob({ providerUserId: user.id, requestId: requestIdOf(formData), ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function providerWithdrawAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "updateJobStatus",
    async ({ user, ip }) => {
      const reason = z.string().trim().min(5, "REASON_REQUIRED").max(500).parse(formString(formData, "reason"));
      await providerWithdraw({ providerUserId: user.id, requestId: requestIdOf(formData), reason, ip });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function updateProfileAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "editOwnProviderProfile",
    async ({ user, ip }) => {
      const radius = z.number().int().min(1, "INVALID_RADIUS").max(300, "INVALID_RADIUS").parse(formInt(formData, "serviceRadiusKm"));
      const lat = formString(formData, "lat") ? Number(formString(formData, "lat")) : undefined;
      const lng = formString(formData, "lng") ? Number(formString(formData, "lng")) : undefined;
      const point =
        lat !== undefined && lng !== undefined
          ? z.object({ lat: z.number().min(32).max(37.5), lng: z.number().min(35.5).max(42.5) }).parse({ lat, lng })
          : undefined;
      await updateOwnProfile({
        userId: user.id,
        serviceRadiusKm: radius,
        workingHours: z.string().trim().max(300).parse(formString(formData, "workingHours")),
        coverageAreas: formString(formData, "coverageAreas")
          .split(/[،,]/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 2 && s.length <= 60)
          .slice(0, 10),
        lat: point?.lat,
        lng: point?.lng,
        ip,
      });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}
