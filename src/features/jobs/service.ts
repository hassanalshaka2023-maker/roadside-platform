/**
 * A booked job, from "on my way" to "paid".
 *
 * Money rules enforced here:
 *   - the final amount is COMPUTED (accepted offer + APPROVED extras), never
 *     typed in by the provider
 *   - an extra charge counts only after the customer approves it, and the job
 *     cannot be marked done while one is still waiting for an answer
 *   - completion needs the customer's confirmation; the provider's word is
 *     only half of it, and a disagreement goes to an admin
 *   - commission uses the rate snapshotted when the offer was accepted
 */
import "server-only";

import type { CommissionBase } from "@prisma/client";

import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { loggerFor } from "@/lib/logger";
import { commissionFor, sumSyp } from "@/lib/money";
import { DomainError } from "@/features/requests/errors";
import { releaseBooking } from "@/features/requests/service";
import type { RequestStatusName } from "@/features/requests/state-machine";
import { applyTransition, loadForTransition, type Tx } from "@/features/requests/transition";
import type { ExtraChargeInput } from "@/features/offers/schemas";

const log = loggerFor("jobs/service");

async function loadAssigned(tx: Tx, requestId: string, providerUserId: string) {
  const request = await loadForTransition(tx, requestId);
  // A provider who is not booked on this request cannot even learn it exists.
  if (request.assignedProviderId !== providerUserId) throw new DomainError("NOT_FOUND");
  return request;
}

async function auditStatus(
  actorId: string | null,
  requestId: string,
  from: string,
  to: string,
  actor: string,
  extra?: Record<string, unknown>,
  ip?: string | null,
) {
  await audit({
    actorId,
    action: "request.status.changed",
    entityType: "ServiceRequest",
    entityId: requestId,
    metadata: { from, to, actor, ...extra },
    ip,
  });
}

// ---------------------------------------------------------------------------
// Provider progress
// ---------------------------------------------------------------------------

export type ProviderStep = "ON_THE_WAY" | "ARRIVED" | "IN_PROGRESS";

export async function advanceJob(params: {
  providerUserId: string;
  requestId: string;
  to: ProviderStep;
  /** Optional new ETA when setting off. */
  etaMinutes?: number;
  ip?: string | null;
}): Promise<void> {
  const { providerUserId, requestId, to, etaMinutes, ip } = params;

  const from = await prisma.$transaction(async (tx) => {
    const request = await loadAssigned(tx, requestId, providerUserId);
    await applyTransition(tx, {
      requestId,
      from: request.status,
      to,
      actor: "ASSIGNED_PROVIDER",
      actorUserId: providerUserId,
      data:
        to === "ON_THE_WAY" && etaMinutes
          ? { etaAt: new Date(Date.now() + etaMinutes * 60_000) }
          : to === "ARRIVED"
            ? { etaAt: null }
            : undefined,
    });
    return request.status;
  });

  await auditStatus(providerUserId, requestId, from, to, "ASSIGNED_PROVIDER", undefined, ip);
}

/** "I'll be there in N minutes" - updates the ETA without a status change. */
export async function updateEta(params: {
  providerUserId: string;
  requestId: string;
  etaMinutes: number;
}): Promise<void> {
  const updated = await prisma.serviceRequest.updateMany({
    where: {
      id: params.requestId,
      assignedProviderId: params.providerUserId,
      status: { in: ["CONFIRMED", "ON_THE_WAY"] },
    },
    data: { etaAt: new Date(Date.now() + params.etaMinutes * 60_000) },
  });
  if (updated.count === 0) throw new DomainError("NOT_FOUND");
}

/**
 * The provider cannot do the job. Before arrival the request goes back to
 * searching so the customer is not stranded; after arrival it is cancelled
 * (nothing is charged) and an admin can follow up.
 */
export async function providerWithdraw(params: {
  providerUserId: string;
  requestId: string;
  reason: string;
  ip?: string | null;
}): Promise<void> {
  const { providerUserId, requestId, reason, ip } = params;

  const { from, to } = await prisma.$transaction(async (tx) => {
    const request = await loadAssigned(tx, requestId, providerUserId);

    if (request.status === "CONFIRMED" || request.status === "ON_THE_WAY") {
      await releaseBooking(tx, {
        requestId,
        from: request.status,
        actor: "ASSIGNED_PROVIDER",
        actorUserId: providerUserId,
        note: `provider withdrew: ${reason}`,
      });
      return { from: request.status, to: "SEARCHING" as const };
    }

    await applyTransition(tx, {
      requestId,
      from: request.status,
      to: "CANCELLED_BY_PROVIDER",
      actor: "ASSIGNED_PROVIDER",
      actorUserId: providerUserId,
      note: reason,
      data: { cancelledReason: reason },
    });
    await tx.extraCharge.updateMany({
      where: { requestId, status: "PENDING" },
      data: { status: "WITHDRAWN", respondedAt: new Date() },
    });
    return { from: request.status, to: "CANCELLED_BY_PROVIDER" as const };
  });

  await auditStatus(providerUserId, requestId, from, to, "ASSIGNED_PROVIDER", { reason }, ip);
}

// ---------------------------------------------------------------------------
// Extra charges
// ---------------------------------------------------------------------------

export async function proposeExtraCharge(params: {
  providerUserId: string;
  input: ExtraChargeInput;
  ip?: string | null;
}): Promise<{ extraId: string }> {
  const { providerUserId, input, ip } = params;
  const totalSyp = sumSyp(input.laborSyp, input.partsSyp);

  const extraId = await prisma.$transaction(async (tx) => {
    const request = await loadAssigned(tx, input.requestId, providerUserId);
    if (request.status !== "ARRIVED" && request.status !== "IN_PROGRESS") {
      throw new DomainError("ILLEGAL_TRANSITION", "extras only on site");
    }
    const pending = await tx.extraCharge.count({
      where: { requestId: input.requestId, status: "PENDING" },
    });
    if (pending > 0) throw new DomainError("EXTRA_PENDING");

    const extra = await tx.extraCharge.create({
      data: {
        requestId: input.requestId,
        providerId: providerUserId,
        description: input.description,
        laborSyp: input.laborSyp,
        partsSyp: input.partsSyp,
        totalSyp,
      },
      select: { id: true },
    });
    return extra.id;
  });

  await audit({
    actorId: providerUserId,
    action: "extra.created",
    entityType: "ExtraCharge",
    entityId: extraId,
    metadata: { requestId: input.requestId, laborSyp: input.laborSyp, partsSyp: input.partsSyp, totalSyp },
    ip,
  });

  return { extraId };
}

export async function withdrawExtraCharge(params: {
  providerUserId: string;
  extraId: string;
  ip?: string | null;
}): Promise<void> {
  const updated = await prisma.extraCharge.updateMany({
    where: { id: params.extraId, providerId: params.providerUserId, status: "PENDING" },
    data: { status: "WITHDRAWN", respondedAt: new Date() },
  });
  if (updated.count === 0) throw new DomainError("EXTRA_NOT_AVAILABLE");
  await audit({
    actorId: params.providerUserId,
    action: "extra.withdrawn",
    entityType: "ExtraCharge",
    entityId: params.extraId,
    ip: params.ip,
  });
}

/** The customer's explicit yes or no. Nothing is added without a yes. */
export async function respondToExtraCharge(params: {
  customerId: string;
  extraId: string;
  approve: boolean;
  ip?: string | null;
}): Promise<void> {
  const { customerId, extraId, approve, ip } = params;

  await prisma.$transaction(async (tx) => {
    const extra = await tx.extraCharge.findUnique({
      where: { id: extraId },
      select: { status: true, request: { select: { customerId: true, status: true } } },
    });
    if (!extra || extra.request.customerId !== customerId) throw new DomainError("NOT_FOUND");
    if (extra.status !== "PENDING") throw new DomainError("EXTRA_NOT_AVAILABLE");
    const status = extra.request.status as RequestStatusName;
    if (status !== "ARRIVED" && status !== "IN_PROGRESS") {
      throw new DomainError("EXTRA_NOT_AVAILABLE");
    }

    const updated = await tx.extraCharge.updateMany({
      where: { id: extraId, status: "PENDING" },
      data: { status: approve ? "APPROVED" : "DECLINED", respondedAt: new Date() },
    });
    if (updated.count === 0) throw new DomainError("CONCURRENT_UPDATE");
  });

  await audit({
    actorId: customerId,
    action: approve ? "extra.approved" : "extra.declined",
    entityType: "ExtraCharge",
    entityId: extraId,
    ip,
  });
}

// ---------------------------------------------------------------------------
// Completion and cash
// ---------------------------------------------------------------------------

export type CompletionOutcome =
  /** The work was done: accepted offer + approved extras. */
  | "WORK_DONE"
  /** The customer declined the repair after inspection: callout fee only,
   *  and only when the accepted offer said so. */
  | "CALLOUT_ONLY";

/** Pure: the amount due, from the frozen offer and the approved extras. */
export function computeFinalAmount(
  outcome: CompletionOutcome,
  offer: { calloutFeeSyp: number; totalSyp: number; partsSyp: number; calloutDueIfDeclined: boolean },
  approvedExtras: Array<{ totalSyp: number; partsSyp: number }>,
): { totalSyp: number; partsSyp: number } {
  if (outcome === "CALLOUT_ONLY") {
    if (!offer.calloutDueIfDeclined) throw new DomainError("CALLOUT_NOT_DUE");
    return { totalSyp: offer.calloutFeeSyp, partsSyp: 0 };
  }
  return {
    totalSyp: sumSyp(offer.totalSyp, ...approvedExtras.map((e) => e.totalSyp)),
    partsSyp: sumSyp(offer.partsSyp, ...approvedExtras.map((e) => e.partsSyp)),
  };
}

/** Pure: commission for a completed request under its snapshotted terms. */
export function computeCommission(
  snapshot: { enabled: boolean; rateBps: number; base: CommissionBase | null },
  amounts: { totalSyp: number; partsSyp: number },
): { baseAmountSyp: number; amountSyp: number } {
  if (!snapshot.enabled || snapshot.rateBps === 0) return { baseAmountSyp: 0, amountSyp: 0 };
  const baseAmountSyp =
    snapshot.base === "LABOR" ? amounts.totalSyp - amounts.partsSyp : amounts.totalSyp;
  return { baseAmountSyp, amountSyp: commissionFor(baseAmountSyp, snapshot.rateBps) };
}

/**
 * The provider: "done, and I received the cash". Moves to
 * AWAITING_CONFIRMATION - the customer still has to agree.
 */
export async function markJobDone(params: {
  providerUserId: string;
  requestId: string;
  outcome: CompletionOutcome;
  ip?: string | null;
}): Promise<{ finalAmountSyp: number }> {
  const { providerUserId, requestId, outcome, ip } = params;

  const result = await prisma.$transaction(async (tx) => {
    const request = await loadAssigned(tx, requestId, providerUserId);
    if (!request.acceptedOfferId) throw new DomainError("ILLEGAL_TRANSITION", "no accepted offer");

    const pendingExtras = await tx.extraCharge.count({ where: { requestId, status: "PENDING" } });
    if (pendingExtras > 0) throw new DomainError("EXTRA_PENDING");

    const offer = await tx.requestOffer.findUniqueOrThrow({
      where: { id: request.acceptedOfferId },
      select: { calloutFeeSyp: true, totalSyp: true, partsSyp: true, calloutDueIfDeclined: true },
    });
    const approved = await tx.extraCharge.findMany({
      where: { requestId, status: "APPROVED" },
      select: { totalSyp: true, partsSyp: true },
    });

    const amount = computeFinalAmount(outcome, offer, outcome === "WORK_DONE" ? approved : []);

    await applyTransition(tx, {
      requestId,
      from: request.status,
      to: "AWAITING_CONFIRMATION",
      actor: "ASSIGNED_PROVIDER",
      actorUserId: providerUserId,
      note: outcome === "CALLOUT_ONLY" ? "callout fee only" : "work done",
      data: { finalAmountSyp: amount.totalSyp, providerConfirmedAt: new Date() },
    });

    return { from: request.status, finalAmountSyp: amount.totalSyp };
  });

  await auditStatus(
    providerUserId,
    requestId,
    result.from,
    "AWAITING_CONFIRMATION",
    "ASSIGNED_PROVIDER",
    { outcome, finalAmountSyp: result.finalAmountSyp },
    ip,
  );

  return { finalAmountSyp: result.finalAmountSyp };
}

/** Pressed "done" too early: back to work, the declared amount is cleared. */
export async function reopenJob(params: { providerUserId: string; requestId: string; ip?: string | null }) {
  const { providerUserId, requestId, ip } = params;
  await prisma.$transaction(async (tx) => {
    const request = await loadAssigned(tx, requestId, providerUserId);
    await applyTransition(tx, {
      requestId,
      from: request.status,
      to: "IN_PROGRESS",
      actor: "ASSIGNED_PROVIDER",
      actorUserId: providerUserId,
      note: "reopened by provider",
      data: { finalAmountSyp: null, providerConfirmedAt: null },
    });
  });
  await auditStatus(providerUserId, requestId, "AWAITING_CONFIRMATION", "IN_PROGRESS", "ASSIGNED_PROVIDER", undefined, ip);
}

/**
 * Final step, shared by the customer's confirmation and an admin's dispute
 * resolution: stamps completion, writes the commission snapshot and ledger
 * entry, and counts the job on the provider's profile.
 */
async function finalizeCompletion(
  tx: Tx,
  params: {
    requestId: string;
    from: RequestStatusName;
    actor: "CUSTOMER" | "ADMIN";
    actorUserId: string;
    note: string;
    finalAmountOverride?: number;
    disputeResolution?: string;
  },
): Promise<{ commissionSyp: number }> {
  const request = await tx.serviceRequest.findUniqueOrThrow({
    where: { id: params.requestId },
    select: {
      assignedProviderId: true,
      acceptedOfferId: true,
      finalAmountSyp: true,
      commissionEnabled: true,
      commissionRateBps: true,
      commissionBase: true,
    },
  });
  if (!request.assignedProviderId || !request.acceptedOfferId || request.finalAmountSyp === null) {
    throw new DomainError("ILLEGAL_TRANSITION", "nothing to complete");
  }

  const finalAmountSyp = params.finalAmountOverride ?? request.finalAmountSyp;

  // Parts are excluded from a LABOR-based commission. When an admin overrides
  // the amount, parts are capped at the new total.
  const offer = await tx.requestOffer.findUniqueOrThrow({
    where: { id: request.acceptedOfferId },
    select: { partsSyp: true },
  });
  const approved = await tx.extraCharge.findMany({
    where: { requestId: params.requestId, status: "APPROVED" },
    select: { partsSyp: true },
  });
  const partsSyp = Math.min(
    finalAmountSyp,
    sumSyp(offer.partsSyp, ...approved.map((e) => e.partsSyp)),
  );

  const commission = computeCommission(
    {
      enabled: request.commissionEnabled,
      rateBps: request.commissionRateBps,
      base: request.commissionBase,
    },
    { totalSyp: finalAmountSyp, partsSyp },
  );

  const now = new Date();
  await applyTransition(tx, {
    requestId: params.requestId,
    from: params.from,
    to: "COMPLETED",
    actor: params.actor,
    actorUserId: params.actorUserId,
    note: params.note,
    data: {
      finalAmountSyp,
      completedAt: now,
      customerConfirmedAt: params.actor === "CUSTOMER" ? now : undefined,
      commissionSyp: commission.amountSyp,
      disputeResolution: params.disputeResolution,
    },
  });

  if (commission.amountSyp > 0) {
    await tx.commissionEntry.create({
      data: {
        requestId: params.requestId,
        providerId: request.assignedProviderId,
        baseAmountSyp: commission.baseAmountSyp,
        rateBps: request.commissionRateBps,
        amountSyp: commission.amountSyp,
      },
    });
  }

  await tx.providerProfile.update({
    where: { userId: request.assignedProviderId },
    data: { completedJobs: { increment: 1 } },
  });

  return { commissionSyp: commission.amountSyp };
}

/** The customer: "the work is done and I paid this amount in cash". */
export async function confirmCompletion(params: {
  customerId: string;
  requestId: string;
  ip?: string | null;
}): Promise<void> {
  const { customerId, requestId, ip } = params;

  const result = await prisma.$transaction(async (tx) => {
    const request = await loadForTransition(tx, requestId);
    if (request.customerId !== customerId) throw new DomainError("NOT_FOUND");
    return finalizeCompletion(tx, {
      requestId,
      from: request.status,
      actor: "CUSTOMER",
      actorUserId: customerId,
      note: "customer confirmed completion and cash payment",
    });
  });

  log.info({ requestId }, "request completed");
  await auditStatus(customerId, requestId, "AWAITING_CONFIRMATION", "COMPLETED", "CUSTOMER", result, ip);
}

/** The customer disagrees: not done, or not that amount. An admin decides. */
export async function disputeCompletion(params: {
  customerId: string;
  requestId: string;
  reason: string;
  ip?: string | null;
}): Promise<void> {
  const { customerId, requestId, reason, ip } = params;

  await prisma.$transaction(async (tx) => {
    const request = await loadForTransition(tx, requestId);
    if (request.customerId !== customerId) throw new DomainError("NOT_FOUND");
    await applyTransition(tx, {
      requestId,
      from: request.status,
      to: "DISPUTED",
      actor: "CUSTOMER",
      actorUserId: customerId,
      note: reason,
      data: { disputeReason: reason },
    });
  });

  await auditStatus(customerId, requestId, "AWAITING_CONFIRMATION", "DISPUTED", "CUSTOMER", { reason }, ip);
}

/**
 * Admin settles a dispute, or confirms a completion the customer never
 * answered. Changing the amount is explicit, requires a written reason and is
 * audited with the before and after values - never silent.
 */
export async function resolveByAdmin(params: {
  adminId: string;
  requestId: string;
  outcome: "COMPLETED" | "CANCELLED";
  resolution: string;
  finalAmountSyp?: number;
  ip?: string | null;
}): Promise<void> {
  const { adminId, requestId, outcome, resolution, finalAmountSyp, ip } = params;

  const summary = await prisma.$transaction(async (tx) => {
    const request = await loadForTransition(tx, requestId);
    const before = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { finalAmountSyp: true },
    });

    if (outcome === "CANCELLED") {
      await applyTransition(tx, {
        requestId,
        from: request.status,
        to: "CANCELLED_BY_ADMIN",
        actor: "ADMIN",
        actorUserId: adminId,
        note: resolution,
        data: { cancelledReason: resolution, disputeResolution: resolution },
      });
      return { from: request.status, before: before.finalAmountSyp, after: null, commissionSyp: 0 };
    }

    const { commissionSyp } = await finalizeCompletion(tx, {
      requestId,
      from: request.status,
      actor: "ADMIN",
      actorUserId: adminId,
      note: `resolved by admin: ${resolution}`,
      finalAmountOverride: finalAmountSyp,
      disputeResolution: resolution,
    });
    return {
      from: request.status,
      before: before.finalAmountSyp,
      after: finalAmountSyp ?? before.finalAmountSyp,
      commissionSyp,
    };
  });

  await audit({
    actorId: adminId,
    action: "request.dispute.resolved",
    entityType: "ServiceRequest",
    entityId: requestId,
    metadata: { outcome, resolution, ...summary },
    ip,
  });
}
