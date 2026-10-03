/**
 * End-to-end business rules against a real PostgreSQL database.
 *
 * These are the guarantees the brief singles out: approval before work,
 * single booking under concurrency, no unapproved extra cost, completion
 * needing both sides, zero commission in the free period, the towing
 * fallback, and access control between users.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { decideApplication, saveApplication } from "@/features/applications/service";
import { rateProvider, fileComplaint } from "@/features/feedback/service";
import {
  advanceJob,
  confirmCompletion,
  disputeCompletion,
  markJobDone,
  proposeExtraCharge,
  resolveByAdmin,
  respondToExtraCharge,
} from "@/features/jobs/service";
import { listOpenRequestsForProvider } from "@/features/matching/queries";
import { acceptOffer, submitOffer } from "@/features/offers/service";
import { DomainError } from "@/features/requests/errors";
import {
  cancelByCustomer,
  createRequest,
  createTowingFallback,
  restartSearch,
  sweepExpiredSearches,
} from "@/features/requests/service";
import { scheduleCommissionChange, writeSetting } from "@/features/settings/platform";
import {
  applicationInput,
  DAMASCUS,
  makeApprovedProvider,
  makeRequest,
  makeUser,
  offer,
  resetDatabase,
  seedServices,
} from "./helpers";

async function expectDomainError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof DomainError && error.code === code,
  );
}

let services: Awaited<ReturnType<typeof seedServices>>;
let admin: Awaited<ReturnType<typeof makeUser>>;

beforeEach(async () => {
  await resetDatabase();
  services = await seedServices();
  admin = await makeUser("ADMIN");
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Request -> offer -> accepted. Returns everything a job test needs. */
async function bookedJob(prices = { callout: 20_000, labor: 30_000, parts: 0 }) {
  const customer = await makeUser();
  const provider = await makeApprovedProvider(admin.id);
  const request = await makeRequest(customer.id, services.mechanic.id);
  const { offerId } = await submitOffer({ providerUserId: provider.id, input: offer(request.id, prices) });
  await acceptOffer({ requestId: request.id, offerId, actor: "CUSTOMER", actorUserId: customer.id });
  return { customer, provider, request, offerId };
}

// ---------------------------------------------------------------------------

describe("provider approval", () => {
  it("keeps an applicant away from requests until an admin approves", async () => {
    const customer = await makeUser();
    const applicant = await makeUser();
    const input = await applicationInput(applicant.id);
    await saveApplication({ userId: applicant.id, phone: applicant.phone!, input, submit: true });

    const request = await makeRequest(customer.id, services.mechanic.id);

    // Submitted, not approved: still a customer, no feed, no offers.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } })).role).toBe("CUSTOMER");
    expect((await listOpenRequestsForProvider(applicant.id)).items).toHaveLength(0);
    await expectDomainError(
      submitOffer({ providerUserId: applicant.id, input: offer(request.id) }),
      "NOT_ELIGIBLE",
    );

    const app = await prisma.providerApplication.findUniqueOrThrow({ where: { userId: applicant.id } });
    await decideApplication({ adminId: admin.id, applicationId: app.id, decision: "APPROVED" });

    // Approved but offline by default: still nothing until they switch on.
    await expectDomainError(
      submitOffer({ providerUserId: applicant.id, input: offer(request.id) }),
      "NOT_ELIGIBLE",
    );

    await prisma.providerProfile.update({ where: { userId: applicant.id }, data: { isAvailable: true } });
    expect((await listOpenRequestsForProvider(applicant.id)).items.map((i) => i.id)).toEqual([request.id]);
    await expect(submitOffer({ providerUserId: applicant.id, input: offer(request.id) })).resolves.toBeTruthy();
  });

  it("refuses an incomplete submission and records every decision with its reason", async () => {
    const applicant = await makeUser();
    const input = await applicationInput(applicant.id, { consentNoHiddenFees: false });
    await expectDomainError(
      saveApplication({ userId: applicant.id, phone: applicant.phone!, input, submit: true }),
      "APPLICATION_INCOMPLETE",
    );

    await saveApplication({ userId: applicant.id, phone: applicant.phone!, input: { ...input, consentNoHiddenFees: true }, submit: true });
    const app = await prisma.providerApplication.findUniqueOrThrow({ where: { userId: applicant.id } });

    await expectDomainError(
      decideApplication({ adminId: admin.id, applicationId: app.id, decision: "NEEDS_INFO" }),
      "INVALID_DECISION",
    );
    await decideApplication({ adminId: admin.id, applicationId: app.id, decision: "NEEDS_INFO", reason: "صورة الهوية غير واضحة" });

    const after = await prisma.providerApplication.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.status).toBe("NEEDS_INFO");
    expect(after.decisionReason).toBe("صورة الهوية غير واضحة");
    expect(await prisma.applicationDecision.count({ where: { applicationId: app.id } })).toBe(1);
  });

  it("stops a suspended provider immediately and withdraws their live offers", async () => {
    const customer = await makeUser();
    const provider = await makeApprovedProvider(admin.id);
    const request = await makeRequest(customer.id, services.mechanic.id);
    const { offerId } = await submitOffer({ providerUserId: provider.id, input: offer(request.id) });

    const app = await prisma.providerApplication.findUniqueOrThrow({ where: { userId: provider.id } });
    await decideApplication({ adminId: admin.id, applicationId: app.id, decision: "SUSPENDED", reason: "complaints" });

    expect((await prisma.requestOffer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe("WITHDRAWN");
    const other = await makeRequest(customer.id, services.mechanic.id);
    await expectDomainError(submitOffer({ providerUserId: provider.id, input: offer(other.id) }), "NOT_ELIGIBLE");
  });
});

// ---------------------------------------------------------------------------

describe("booking", () => {
  it("books the provider whose offer the customer accepts", async () => {
    const { request, provider, offerId } = await bookedJob();
    const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe("CONFIRMED");
    expect(row.assignedProviderId).toBe(provider.id);
    expect(row.acceptedOfferId).toBe(offerId);
    expect(row.feeTermsAcceptedAt).not.toBeNull();
  });

  it("books exactly one provider when two offers are accepted at the same instant", async () => {
    const customer = await makeUser();
    const p1 = await makeApprovedProvider(admin.id);
    const p2 = await makeApprovedProvider(admin.id);
    const request = await makeRequest(customer.id, services.mechanic.id);
    const o1 = await submitOffer({ providerUserId: p1.id, input: offer(request.id) });
    const o2 = await submitOffer({ providerUserId: p2.id, input: offer(request.id) });

    const results = await Promise.allSettled(
      [o1.offerId, o2.offerId, o1.offerId, o2.offerId].map((offerId) =>
        acceptOffer({ requestId: request.id, offerId, actor: "CUSTOMER", actorUserId: customer.id }),
      ),
    );

    const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe("CONFIRMED");
    expect(await prisma.requestOffer.count({ where: { requestId: request.id, status: "ACCEPTED" } })).toBe(1);
    expect(await prisma.requestStatusHistory.count({ where: { requestId: request.id, toStatus: "CONFIRMED" } })).toBe(1);

    // Every loser failed with a business answer, never a crash.
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(DomainError);
        expect(["ALREADY_BOOKED", "OFFER_NOT_AVAILABLE"]).toContain((result.reason as DomainError).code);
      }
    }
  });

  it("never books one provider on two jobs at once", async () => {
    const provider = await makeApprovedProvider(admin.id);
    const c1 = await makeUser();
    const c2 = await makeUser();
    const r1 = await makeRequest(c1.id, services.mechanic.id);
    const r2 = await makeRequest(c2.id, services.mechanic.id);
    const o1 = await submitOffer({ providerUserId: provider.id, input: offer(r1.id) });
    const o2 = await submitOffer({ providerUserId: provider.id, input: offer(r2.id) });

    const results = await Promise.allSettled([
      acceptOffer({ requestId: r1.id, offerId: o1.offerId, actor: "CUSTOMER", actorUserId: c1.id }),
      acceptOffer({ requestId: r2.id, offerId: o2.offerId, actor: "CUSTOMER", actorUserId: c2.id }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as DomainError).code).toBe("PROVIDER_BUSY");
    expect(
      await prisma.serviceRequest.count({ where: { assignedProviderId: provider.id, status: "CONFIRMED" } }),
    ).toBe(1);
  });

  it("treats a retried acceptance as success, not a second booking", async () => {
    const { request, customer, offerId } = await bookedJob();
    await expect(
      acceptOffer({ requestId: request.id, offerId, actor: "CUSTOMER", actorUserId: customer.id }),
    ).resolves.toEqual({ alreadyAccepted: true });
  });

  it("creates one request when the same form is submitted twice", async () => {
    const customer = await makeUser();
    const clientRequestId = randomUUID();
    const [a, b] = await Promise.all([
      makeRequest(customer.id, services.mechanic.id, { clientRequestId }),
      makeRequest(customer.id, services.mechanic.id, { clientRequestId }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await prisma.serviceRequest.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it("freezes the accepted price in the database itself", async () => {
    const { offerId } = await bookedJob();
    await expect(
      prisma.requestOffer.update({ where: { id: offerId }, data: { laborSyp: 1, totalSyp: 20_001 } }),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE "RequestOffer" SET "totalSyp" = "totalSyp" + 1 WHERE id = ${offerId}::uuid`,
    ).rejects.toThrow();
  });

  it("refuses an expired offer", async () => {
    const customer = await makeUser();
    const provider = await makeApprovedProvider(admin.id);
    const request = await makeRequest(customer.id, services.mechanic.id);
    const { offerId } = await submitOffer({ providerUserId: provider.id, input: offer(request.id) });
    await expectDomainError(
      acceptOffer({
        requestId: request.id,
        offerId,
        actor: "CUSTOMER",
        actorUserId: customer.id,
        now: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }),
      "OFFER_EXPIRED",
    );
  });
});

// ---------------------------------------------------------------------------

describe("extra costs", () => {
  it("are never charged without the customer's approval", async () => {
    const { request, provider, customer } = await bookedJob();
    await advanceJob({ providerUserId: provider.id, requestId: request.id, to: "ON_THE_WAY" });
    await advanceJob({ providerUserId: provider.id, requestId: request.id, to: "ARRIVED" });
    await advanceJob({ providerUserId: provider.id, requestId: request.id, to: "IN_PROGRESS" });

    const first = await proposeExtraCharge({
      providerUserId: provider.id,
      input: { requestId: request.id, description: "بطارية جديدة", laborSyp: 0, partsSyp: 400_000 },
    });

    // Cannot finish while the customer has not answered.
    await expectDomainError(
      markJobDone({ providerUserId: provider.id, requestId: request.id, outcome: "WORK_DONE" }),
      "EXTRA_PENDING",
    );

    await respondToExtraCharge({ customerId: customer.id, extraId: first.extraId, approve: false });
    const declined = await markJobDone({ providerUserId: provider.id, requestId: request.id, outcome: "WORK_DONE" });
    expect(declined.finalAmountSyp).toBe(50_000);
  });

  it("are added once approved", async () => {
    const { request, provider, customer } = await bookedJob();
    await advanceJob({ providerUserId: provider.id, requestId: request.id, to: "ON_THE_WAY" });
    await advanceJob({ providerUserId: provider.id, requestId: request.id, to: "ARRIVED" });
    const extra = await proposeExtraCharge({
      providerUserId: provider.id,
      input: { requestId: request.id, description: "قطعة", laborSyp: 10_000, partsSyp: 90_000 },
    });

    // Somebody else cannot approve it for them.
    const stranger = await makeUser();
    await expectDomainError(
      respondToExtraCharge({ customerId: stranger.id, extraId: extra.extraId, approve: true }),
      "NOT_FOUND",
    );

    await respondToExtraCharge({ customerId: customer.id, extraId: extra.extraId, approve: true });
    const done = await markJobDone({ providerUserId: provider.id, requestId: request.id, outcome: "WORK_DONE" });
    expect(done.finalAmountSyp).toBe(150_000);
  });

  it("charge only the callout fee when the customer declines the repair", async () => {
    const { request, provider } = await bookedJob();
    await advanceJob({ providerUserId: provider.id, requestId: request.id, to: "ON_THE_WAY" });
    await advanceJob({ providerUserId: provider.id, requestId: request.id, to: "ARRIVED" });
    const done = await markJobDone({ providerUserId: provider.id, requestId: request.id, outcome: "CALLOUT_ONLY" });
    expect(done.finalAmountSyp).toBe(20_000);
  });
});

// ---------------------------------------------------------------------------

describe("completion, cash and rating", () => {
  async function finishedJob() {
    const job = await bookedJob();
    await advanceJob({ providerUserId: job.provider.id, requestId: job.request.id, to: "ON_THE_WAY" });
    await advanceJob({ providerUserId: job.provider.id, requestId: job.request.id, to: "ARRIVED" });
    await markJobDone({ providerUserId: job.provider.id, requestId: job.request.id, outcome: "WORK_DONE" });
    return job;
  }

  it("needs the customer to confirm; the provider's word is not enough", async () => {
    const { request, customer } = await finishedJob();
    const pending = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(pending.status).toBe("AWAITING_CONFIRMATION");
    expect(pending.providerConfirmedAt).not.toBeNull();
    expect(pending.customerConfirmedAt).toBeNull();

    await confirmCompletion({ customerId: customer.id, requestId: request.id });
    const done = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(done.status).toBe("COMPLETED");
    expect(done.finalAmountSyp).toBe(50_000);
    expect(done.customerConfirmedAt).not.toBeNull();
  });

  it("keeps commission at zero in the free period", async () => {
    const { request, customer, provider } = await finishedJob();
    await confirmCompletion({ customerId: customer.id, requestId: request.id });
    const done = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(done.commissionEnabled).toBe(false);
    expect(done.commissionSyp).toBe(0);
    expect(await prisma.commissionEntry.count({ where: { providerId: provider.id } })).toBe(0);
  });

  it("applies the rate snapshotted at booking, even if the policy changes later", async () => {
    // Fixture: a 10% policy in force when the offer is accepted.
    await writeSetting(
      "commissionPolicy",
      { current: { enabled: true, rateBps: 1000, base: "TOTAL" }, scheduled: null },
      admin.id,
    );
    const { request, customer, provider } = await finishedJob();

    // Back to free before the customer confirms: the old job keeps its terms.
    await writeSetting(
      "commissionPolicy",
      { current: { enabled: false, rateBps: 0, base: "TOTAL" }, scheduled: null },
      admin.id,
    );
    await confirmCompletion({ customerId: customer.id, requestId: request.id });

    const done = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(done.commissionSyp).toBe(5_000);
    const entry = await prisma.commissionEntry.findUniqueOrThrow({ where: { requestId: request.id } });
    expect(entry).toMatchObject({ providerId: provider.id, amountSyp: 5_000, rateBps: 1000, status: "DUE" });
  });

  it("refuses a commission change without the notice period, and never applies one early", async () => {
    await expect(
      scheduleCommissionChange({
        terms: { enabled: true, rateBps: 500, base: "TOTAL" },
        effectiveFrom: new Date(Date.now() + 60 * 60 * 1000),
        actorId: admin.id,
      }),
    ).rejects.toThrow(/notice/);

    await scheduleCommissionChange({
      terms: { enabled: true, rateBps: 500, base: "TOTAL" },
      effectiveFrom: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      actorId: admin.id,
    });

    const { request, customer } = await finishedJob();
    await confirmCompletion({ customerId: customer.id, requestId: request.id });
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).commissionSyp).toBe(0);
  });

  it("lets the customer dispute, and an admin settle it explicitly", async () => {
    const { request, customer } = await finishedJob();
    await disputeCompletion({ customerId: customer.id, requestId: request.id, reason: "دفعت أقل من ذلك" });
    await resolveByAdmin({
      adminId: admin.id,
      requestId: request.id,
      outcome: "COMPLETED",
      resolution: "اتفق الطرفان على 40000",
      finalAmountSyp: 40_000,
    });
    const done = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(done.status).toBe("COMPLETED");
    expect(done.finalAmountSyp).toBe(40_000);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "request.dispute.resolved" } });
    expect(log.metadata).toMatchObject({ before: 50_000, after: 40_000 });
  });

  it("allows one rating, only after completion, and keeps a true average", async () => {
    const { request, customer, provider } = await finishedJob();
    await expectDomainError(
      rateProvider({ customerId: customer.id, requestId: request.id, stars: 5 }),
      "NOT_RATEABLE",
    );
    await confirmCompletion({ customerId: customer.id, requestId: request.id });
    await rateProvider({ customerId: customer.id, requestId: request.id, stars: 4 });
    await expectDomainError(
      rateProvider({ customerId: customer.id, requestId: request.id, stars: 5 }),
      "ALREADY_RATED",
    );
    const profile = await prisma.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
    expect(profile.ratingCount).toBe(1);
    expect(profile.ratingAverage).toBe(4);
    expect(profile.completedJobs).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("no provider available", () => {
  it("closes the search from real data and offers a towing request only on request", async () => {
    const customer = await makeUser();
    const request = await makeRequest(customer.id, services.mechanic.id);

    // Not yet due.
    expect(await sweepExpiredSearches(new Date())).toBe(0);
    // Past the window, with no offers at all.
    expect(await sweepExpiredSearches(new Date(Date.now() + 2 * 60 * 60 * 1000))).toBe(1);
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      "NO_PROVIDER_AVAILABLE",
    );

    // Nothing was created behind the customer's back.
    expect(await prisma.serviceRequest.count({ where: { customerId: customer.id } })).toBe(1);

    const tow = await createTowingFallback({
      requestId: request.id,
      customerId: customer.id,
      clientRequestId: randomUUID(),
      destinationText: "ورشة أبو علي - المزة",
    });
    const towRow = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: tow.id }, include: { serviceType: true } });
    expect(towRow.serviceType.slug).toBe("towing");
    expect(towRow.fallbackFromId).toBe(request.id);
    expect(towRow.lat).toBeCloseTo(DAMASCUS.lat + 0.01);
    expect(towRow.carMake).toBe("Kia");
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      "CANCELLED_BY_CUSTOMER",
    );

    // No fallback from a tow, and no second "no provider" for it either.
    await sweepExpiredSearches(new Date(Date.now() + 2 * 60 * 60 * 1000));
    await expectDomainError(
      createTowingFallback({
        requestId: tow.id,
        customerId: customer.id,
        clientRequestId: randomUUID(),
        destinationText: "x y z",
      }),
      "FALLBACK_NOT_ALLOWED",
    );

    // "Try again" reopens the search.
    await restartSearch({ requestId: tow.id, actor: "CUSTOMER", actorUserId: customer.id });
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: tow.id } })).status).toBe("SEARCHING");
  });

  it("does not close a search while an offer is still valid", async () => {
    const customer = await makeUser();
    const provider = await makeApprovedProvider(admin.id);
    const request = await makeRequest(customer.id, services.mechanic.id);
    await prisma.serviceRequest.update({
      where: { id: request.id },
      data: { searchExpiresAt: new Date(Date.now() - 1000) },
    });
    // The provider was invited, so they may still bid after the window.
    await prisma.requestInvite.create({ data: { requestId: request.id, providerId: provider.id } });
    await submitOffer({ providerUserId: provider.id, input: offer(request.id) });

    expect(await sweepExpiredSearches()).toBe(0);
    expect(await sweepExpiredSearches(new Date(Date.now() + 2 * 60 * 60 * 1000))).toBe(1);
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("EXPIRED");
  });

  it("requires a destination for towing", async () => {
    const customer = await makeUser();
    await expectDomainError(makeRequest(customer.id, services.towing.id), "DESTINATION_REQUIRED");
  });
});

// ---------------------------------------------------------------------------

describe("access between users", () => {
  it("does not let another customer cancel or confirm someone's request", async () => {
    const { request } = await bookedJob();
    const stranger = await makeUser();
    await expectDomainError(cancelByCustomer({ requestId: request.id, customerId: stranger.id }), "NOT_FOUND");
    await expectDomainError(confirmCompletion({ customerId: stranger.id, requestId: request.id }), "NOT_FOUND");
    await expectDomainError(
      fileComplaint({ userId: stranger.id, requestId: request.id, category: "PRICE", description: "....." }),
      "NOT_FOUND",
    );
  });

  it("does not let another provider move a job they are not booked on", async () => {
    const { request } = await bookedJob();
    const other = await makeApprovedProvider(admin.id);
    await expectDomainError(
      advanceJob({ providerUserId: other.id, requestId: request.id, to: "ON_THE_WAY" }),
      "NOT_FOUND",
    );
  });

  it("shows candidates the area the customer typed, but never the pin or the customer", async () => {
    const customer = await makeUser();
    const provider = await makeApprovedProvider(admin.id);
    await makeRequest(customer.id, services.mechanic.id, { landmarkText: "مقابل الجامع", addressText: "برزة" });
    const { items } = await listOpenRequestsForProvider(provider.id);
    expect(items).toHaveLength(1);
    const item = items[0] as unknown as Record<string, unknown>;
    expect(item.areaText).toBe("برزة");
    expect(item.landmark).toBe("مقابل الجامع");
    for (const hidden of ["lat", "lng", "customerId", "customer", "contactPhone", "photoIds", "plateNumber"]) {
      expect(item).not.toHaveProperty(hidden);
    }
    expect(item.approxDistanceKm).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(item.approxDistanceKm)).toBe(true);
  });

  it("does not let a customer attach someone else's upload", async () => {
    const owner = await makeUser();
    const thief = await makeUser();
    const file = await prisma.uploadedFile.create({
      data: { ownerId: owner.id, kind: "REQUEST_PHOTO", storageKey: randomUUID(), mimeType: "image/jpeg", sizeBytes: 1, sha256: "0" },
    });
    await expectDomainError(
      createRequest({
        customerId: thief.id,
        idRequired: false,
        input: {
          clientRequestId: randomUUID(),
          serviceTypeId: services.mechanic.id,
          lat: DAMASCUS.lat,
          lng: DAMASCUS.lng,
          governorate: "damascus",
          photoIds: [file.id],
          problemUnknown: true,
          locationApproximate: false,
        },
      }),
      "NOT_FOUND",
    );
  });
});
