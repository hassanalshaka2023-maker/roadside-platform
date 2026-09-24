/**
 * Admin dashboard figures, straight from the database - no estimates, no
 * padding.
 *
 * Service value and platform revenue are kept apart on purpose: customers pay
 * providers in cash, so the value of completed services is the PROVIDERS'
 * income. The platform earns only recorded commission, which is zero during
 * the free period.
 */
import "server-only";

import { prisma } from "@/lib/db";

export interface DashboardStats {
  since: Date | null;
  requests: {
    total: number;
    searching: number;
    active: number;
    completed: number;
    cancelled: number;
    noProvider: number;
    disputed: number;
  };
  /** Sum of final amounts of completed requests. Providers' income. */
  serviceValueSyp: number;
  /** Platform revenue: commission recorded on completed requests. */
  commissionEarnedSyp: number;
  commissionSettledSyp: number;
  pendingApplications: number;
  openComplaints: number;
  activeProviders: number;
  availableProviders: number;
}

export async function getDashboardStats(sinceDays: number | null): Promise<DashboardStats> {
  const since = sinceDays ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000) : null;
  const created = since ? { createdAt: { gte: since } } : {};
  const completedWindow = since ? { completedAt: { gte: since } } : {};

  const [
    grouped,
    completedAgg,
    settled,
    pendingApplications,
    openComplaints,
    activeProviders,
    availableProviders,
  ] = await Promise.all([
    prisma.serviceRequest.groupBy({ by: ["status"], where: created, _count: { _all: true } }),
    prisma.serviceRequest.aggregate({
      where: { status: "COMPLETED", ...completedWindow },
      _sum: { finalAmountSyp: true, commissionSyp: true },
    }),
    prisma.commissionEntry.aggregate({
      where: { status: "SETTLED", ...(since ? { updatedAt: { gte: since } } : {}) },
      _sum: { amountSyp: true },
    }),
    prisma.providerApplication.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.complaint.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    prisma.providerProfile.count({ where: { status: "ACTIVE" } }),
    prisma.providerProfile.count({ where: { status: "ACTIVE", isAvailable: true } }),
  ]);

  const count = (...statuses: string[]) =>
    grouped
      .filter((row) => statuses.includes(row.status))
      .reduce((sum, row) => sum + row._count._all, 0);

  return {
    since,
    requests: {
      total: grouped.reduce((sum, row) => sum + row._count._all, 0),
      searching: count("SEARCHING"),
      active: count("CONFIRMED", "ON_THE_WAY", "ARRIVED", "IN_PROGRESS", "AWAITING_CONFIRMATION"),
      completed: count("COMPLETED"),
      cancelled: count("CANCELLED_BY_CUSTOMER", "CANCELLED_BY_PROVIDER", "CANCELLED_BY_ADMIN"),
      noProvider: count("NO_PROVIDER_AVAILABLE", "EXPIRED"),
      disputed: count("DISPUTED"),
    },
    serviceValueSyp: completedAgg._sum.finalAmountSyp ?? 0,
    commissionEarnedSyp: completedAgg._sum.commissionSyp ?? 0,
    commissionSettledSyp: settled._sum.amountSyp ?? 0,
    pendingApplications,
    openComplaints,
    activeProviders,
    availableProviders,
  };
}
