"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { formString, runAction, type ActionResult } from "@/lib/action-result";
import { DomainError } from "@/features/requests/errors";
import { applicationInputSchema, DECISIONS } from "./schemas";
import { decideApplication, saveApplication } from "./service";

/** The applicant saves a draft (`intent=draft`) or submits (`intent=submit`). */
export async function saveApplicationAction(
  _prev: ActionResult<{ status: string; missing?: string[] }>,
  formData: FormData,
): Promise<ActionResult<{ status: string; missing?: string[] }>> {
  return runAction(
    "applyAsProvider",
    async ({ user, ip }) => {
      if (!user.phone) throw new DomainError("PROVIDER_ROLE_CONFLICT");
      let payload: unknown;
      try {
        payload = JSON.parse(formString(formData, "payload") || "{}");
      } catch {
        payload = {};
      }
      const input = applicationInputSchema.parse(payload);
      const submit = formString(formData, "intent") === "submit";
      const saved = await saveApplication({ userId: user.id, phone: user.phone, input, submit, ip });
      refresh();
      return { status: saved.status };
    },
    { rateLimit: "applicationSavePerUser" },
  );
}

export async function decideApplicationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "reviewProviderApplications",
    async ({ user, ip }) => {
      await decideApplication({
        adminId: user.id,
        applicationId: z.uuid().parse(formString(formData, "applicationId")),
        decision: z.enum(DECISIONS).parse(formString(formData, "decision")),
        reason: z.string().trim().max(1000).parse(formString(formData, "reason")) || undefined,
        ip,
      });
      refresh();
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}
