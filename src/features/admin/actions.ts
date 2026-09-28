"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { formAmount, formBool, formInt, formString, runAction, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { readSessionFromCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { percentToBps } from "@/lib/money";
import { accountChangeSchema, changeOwnCredentials } from "@/features/admin/account";
import { settleAllDue, waiveEntry } from "@/features/commission/service";
import { updateComplaint } from "@/features/feedback/service";
import { resolveByAdmin } from "@/features/jobs/service";
import { setProviderServices, setUserStatus } from "@/features/providers/service";
import { DomainError } from "@/features/requests/errors";
import { cancelByAdmin, inviteProvider, reassignByAdmin, restartSearch } from "@/features/requests/service";
import {
  cancelScheduledCommission,
  CommissionNoticeError,
  scheduleCommissionChange,
  writeSetting,
} from "@/features/settings/platform";

const uuid = z.uuid();
const reason = z.string().trim().min(3, "REASON_REQUIRED").max(1000);
const requestIdOf = (formData: FormData) => uuid.parse(formString(formData, "requestId"));

// --- requests ---------------------------------------------------------------

export async function adminCancelAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("cancelAnyRequest", async ({ user, ip }) => {
    await cancelByAdmin({ requestId: requestIdOf(formData), adminId: user.id, reason: reason.parse(formString(formData, "reason")), ip });
    refresh();
    return undefined;
  });
}

export async function adminReassignAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("dispatchRequests", async ({ user, ip }) => {
    await reassignByAdmin({ requestId: requestIdOf(formData), adminId: user.id, reason: reason.parse(formString(formData, "reason")), ip });
    refresh();
    return undefined;
  });
}

export async function adminInviteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("dispatchRequests", async ({ user, ip }) => {
    await inviteProvider({
      requestId: requestIdOf(formData),
      providerUserId: uuid.parse(formString(formData, "providerUserId")),
      adminId: user.id,
      ip,
    });
    refresh();
    return undefined;
  });
}

export async function adminRestartAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("dispatchRequests", async ({ user, ip }) => {
    await restartSearch({ requestId: requestIdOf(formData), actor: "ADMIN", actorUserId: user.id, ip });
    refresh();
    return undefined;
  });
}

export async function adminResolveAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("resolveDisputes", async ({ user, ip }) => {
    const outcome = z.enum(["COMPLETED", "CANCELLED"]).parse(formString(formData, "outcome"));
    const raw = formString(formData, "finalAmountSyp");
    const amount = raw.trim() === "" ? undefined : formAmount(formData, "finalAmountSyp");
    if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < 0)) throw new DomainError("INVALID_AMOUNT");
    await resolveByAdmin({
      adminId: user.id,
      requestId: requestIdOf(formData),
      outcome,
      resolution: reason.parse(formString(formData, "resolution")),
      finalAmountSyp: amount,
      ip,
    });
    refresh();
    return undefined;
  });
}

// --- complaints, users, providers -------------------------------------------

export async function updateComplaintAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("manageComplaints", async ({ user, ip }) => {
    await updateComplaint({
      adminId: user.id,
      complaintId: uuid.parse(formString(formData, "complaintId")),
      status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"]).parse(formString(formData, "status")),
      adminNote: z.string().trim().max(1000).parse(formString(formData, "adminNote")),
      ip,
    });
    refresh();
    return undefined;
  });
}

export async function setUserStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("manageUsers", async ({ user, ip }) => {
    await setUserStatus({
      adminId: user.id,
      userId: uuid.parse(formString(formData, "userId")),
      status: z.enum(["ACTIVE", "SUSPENDED"]).parse(formString(formData, "status")),
      reason: reason.parse(formString(formData, "reason")),
      ip,
    });
    refresh();
    return undefined;
  });
}

export async function setProviderServicesAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("manageProviders", async ({ user, ip }) => {
    await setProviderServices({
      adminId: user.id,
      providerUserId: uuid.parse(formString(formData, "userId")),
      serviceTypeIds: z.array(uuid).parse(formData.getAll("serviceTypeIds").map(String)),
      ip,
    });
    refresh();
    return undefined;
  });
}

// --- commission -------------------------------------------------------------

export async function settleCommissionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("manageCommission", async ({ user, ip }) => {
    await settleAllDue({
      adminId: user.id,
      providerUserId: uuid.parse(formString(formData, "userId")),
      note: z.string().trim().max(300).parse(formString(formData, "note")),
      ip,
    });
    refresh();
    return undefined;
  });
}

export async function waiveCommissionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("manageCommission", async ({ user, ip }) => {
    await waiveEntry({ adminId: user.id, entryId: uuid.parse(formString(formData, "entryId")), ip });
    refresh();
    return undefined;
  });
}

export async function scheduleCommissionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("manageCommission", async ({ user, ip }) => {
    const enabled = formBool(formData, "enabled");
    const rateBps = enabled ? percentToBps(formString(formData, "ratePercent")) : 0;
    if (rateBps === null) throw new DomainError("INVALID_AMOUNT");
    const effectiveFrom = new Date(formString(formData, "effectiveFrom"));
    if (Number.isNaN(effectiveFrom.getTime())) throw new DomainError("INVALID_AMOUNT", "date");
    try {
      await scheduleCommissionChange({
        terms: { enabled, rateBps, base: z.enum(["TOTAL", "LABOR"]).parse(formString(formData, "base")) },
        effectiveFrom,
        actorId: user.id,
        ip,
      });
    } catch (error) {
      if (error instanceof CommissionNoticeError) {
        throw new z.ZodError([{ code: "custom", path: ["effectiveFrom"], message: "NOTICE_TOO_SHORT", input: undefined }]);
      }
      throw error;
    }
    refresh();
    return undefined;
  });
}

export async function cancelScheduledCommissionAction(): Promise<ActionResult> {
  return runAction("manageCommission", async ({ user, ip }) => {
    await cancelScheduledCommission(user.id, ip);
    refresh();
    return undefined;
  });
}

// --- settings ----------------------------------------------------------------

export async function updateMatchingSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("manageSettings", async ({ user, ip }) => {
    for (const key of ["searchRadiusKm", "searchTimeoutMinutes", "offerValidityMinutes", "maxOffersPerRequest", "commissionNoticeDays"] as const) {
      const value = formInt(formData, key);
      if (value === undefined) continue;
      await writeSetting(key, value, user.id, ip).catch(() => {
        throw new DomainError("INVALID_AMOUNT", key);
      });
    }
    refresh();
    return undefined;
  });
}

export async function updateContactSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("manageSettings", async ({ user, ip }) => {
    const phones = formString(formData, "businessPhones")
      .split(/[\s,،]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const parsedPhones = z.array(z.string().regex(/^0\d{9}$/, "INVALID_PHONE_LIST")).max(5).parse(phones);
    await writeSetting("businessPhones", parsedPhones, user.id, ip);
    await writeSetting("whatsappEnabled", formBool(formData, "whatsappEnabled"), user.id, ip);
    await writeSetting(
      "customerIdMode",
      z.enum(["NEVER", "FIRST_REQUEST_ONLY", "ALWAYS"]).parse(formString(formData, "customerIdMode")),
      user.id,
      ip,
    );
    await writeSetting(
      "cancellationPolicy",
      { ar: formString(formData, "cancellationPolicyAr").slice(0, 2000), en: formString(formData, "cancellationPolicyEn").slice(0, 2000) },
      user.id,
      ip,
    );
    refresh();
    return undefined;
  });
}

export async function toggleServiceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("manageServiceTypes", async ({ user, ip }) => {
    const id = uuid.parse(formString(formData, "serviceTypeId"));
    const isActive = formString(formData, "isActive") === "true";
    await prisma.serviceType.update({ where: { id }, data: { isActive } });
    await audit({ actorId: user.id, action: "service.updated", entityType: "ServiceType", entityId: id, metadata: { isActive }, ip });
    refresh();
    return undefined;
  });
}

// --- own account ------------------------------------------------------------

export async function changeOwnCredentialsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(
    "manageOwnAccount",
    async ({ user, ip }) => {
      const input = accountChangeSchema.parse({
        currentPassword: formString(formData, "currentPassword"),
        email: formString(formData, "email"),
        newPassword: formString(formData, "newPassword"),
        confirmPassword: formString(formData, "confirmPassword"),
      });
      const session = await readSessionFromCookie();
      await changeOwnCredentials({ userId: user.id, input, keepSessionId: session?.sessionId ?? null, ip });
      refresh();
      return undefined;
    },
    { rateLimit: "accountChangePerUser" },
  );
}
