/**
 * Commission ledger.
 *
 * Cash goes from the customer straight to the provider, so the platform's
 * share (zero during the free period) is recorded as a debt the provider owes,
 * and settled later in cash. Entries are created at completion from the rate
 * snapshotted when the offer was accepted; nothing here ever recalculates an
 * old entry from today's settings.
 */
import "server-only";

import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { DomainError } from "@/features/requests/errors";

export interface ProviderEarnings {
  completedJobs: number;
  /** What customers paid this provider. The platform's revenue is NOT this. */
  serviceValueSyp: number;
  commissionDueSyp: number;
  commissionSettledSyp: number;
}

export async function getProviderEarnings(providerUserId: string): Promise<ProviderEarnings> {
  const [completed, due, settled] = await Promise.all([
    prisma.serviceRequest.aggregate({
      where: { assignedProviderId: providerUserId, status: "COMPLETED" },
      _count: { _all: true },
      _sum: { finalAmountSyp: true },
    }),
    prisma.commissionEntry.aggregate({
      where: { providerId: providerUserId, status: "DUE" },
      _sum: { amountSyp: true },
    }),
    prisma.commissionEntry.aggregate({
      where: { providerId: providerUserId, status: "SETTLED" },
      _sum: { amountSyp: true },
    }),
  ]);

  return {
    completedJobs: completed._count._all,
    serviceValueSyp: completed._sum.finalAmountSyp ?? 0,
    commissionDueSyp: due._sum.amountSyp ?? 0,
    commissionSettledSyp: settled._sum.amountSyp ?? 0,
  };
}

export async function listCommissionEntries(providerUserId: string, limit = 50) {
  return prisma.commissionEntry.findMany({
    where: { providerId: providerUserId },
    select: {
      id: true,
      amountSyp: true,
      baseAmountSyp: true,
      rateBps: true,
      status: true,
      createdAt: true,
      request: { select: { publicCode: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Records a cash settlement covering every DUE entry of a provider. The
 * amount is computed, not typed, so the ledger always balances.
 */
export async function settleAllDue(params: {
  adminId: string;
  providerUserId: string;
  note?: string;
  ip?: string | null;
}): Promise<{ settlementId: string; amountSyp: number }> {
  const { adminId, providerUserId, note, ip } = params;

  const result = await prisma.$transaction(async (tx) => {
    const due = await tx.commissionEntry.findMany({
      where: { providerId: providerUserId, status: "DUE" },
      select: { id: true, amountSyp: true },
    });
    const amountSyp = due.reduce((sum, entry) => sum + entry.amountSyp, 0);
    if (amountSyp <= 0) throw new DomainError("INVALID_AMOUNT", "nothing due");

    const settlement = await tx.commissionSettlement.create({
      data: { providerId: providerUserId, amountSyp, note: note || null, recordedById: adminId },
      select: { id: true },
    });
    const updated = await tx.commissionEntry.updateMany({
      where: { id: { in: due.map((e) => e.id) }, status: "DUE" },
      data: { status: "SETTLED", settlementId: settlement.id },
    });
    if (updated.count !== due.length) throw new DomainError("CONCURRENT_UPDATE");

    return { settlementId: settlement.id, amountSyp };
  });

  await audit({
    actorId: adminId,
    action: "commission.settlement.recorded",
    entityType: "CommissionSettlement",
    entityId: result.settlementId,
    metadata: { providerUserId, amountSyp: result.amountSyp },
    ip,
  });

  return result;
}

export async function waiveEntry(params: { adminId: string; entryId: string; ip?: string | null }) {
  const updated = await prisma.commissionEntry.updateMany({
    where: { id: params.entryId, status: "DUE" },
    data: { status: "WAIVED" },
  });
  if (updated.count === 0) throw new DomainError("NOT_FOUND");
  await audit({
    actorId: params.adminId,
    action: "commission.entry.waived",
    entityType: "CommissionEntry",
    entityId: params.entryId,
    ip: params.ip,
  });
}
