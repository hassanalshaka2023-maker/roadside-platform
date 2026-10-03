/**
 * Push notifications against the real database: who is alerted, and who is
 * not. The push service itself is faked; everything up to the network call
 * (eligibility, sessions, cleanup) is real.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sent, pending } = vi.hoisted(() => {
  // Push is off unless the keys exist; env.ts reads them at import time.
  process.env.VAPID_PUBLIC_KEY = "BTestPublicKeyThatIsLongEnoughForTheSchema0000";
  process.env.VAPID_PRIVATE_KEY = "TestPrivateKeyThatIsLongEnough000000";
  process.env.VAPID_SUBJECT = "mailto:test@example.test";
  return {
    sent: [] as Array<{ endpoint: string; payload: { title: string; url: string } }>,
    pending: [] as Promise<unknown>[],
  };
});

vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(public statusCode: number) {
      super(`push failed ${statusCode}`);
    }
  }
  return {
    WebPushError,
    default: {
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn(async (sub: { endpoint: string }, body: string) => {
        if (sub.endpoint.includes("gone")) throw new WebPushError(410);
        sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
        return {};
      }),
    },
  };
});

// `after()` needs a live request; collect the tasks so the test can await them.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => {
    pending.push(task());
  },
}));

import { prisma } from "@/lib/db";
import { submitOffer } from "@/features/offers/service";
import { DAMASCUS, makeApprovedProvider, makeRequest, makeUser, offer, resetDatabase, seedServices } from "./helpers";

async function settle() {
  while (pending.length > 0) await Promise.all(pending.splice(0));
}

async function subscribe(userId: string, label: string, options: { revoked?: boolean } = {}) {
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: options.revoked ? new Date() : null,
    },
  });
  const endpoint = `https://push.example.test/${label}`;
  await prisma.pushSubscription.create({
    data: { userId, sessionId: session.id, endpoint, p256dh: "p256dh-key-000", auth: "auth-key-000", locale: "ar" },
  });
  return endpoint;
}

let services: Awaited<ReturnType<typeof seedServices>>;
let admin: Awaited<ReturnType<typeof makeUser>>;

beforeEach(async () => {
  await resetDatabase();
  sent.length = 0;
  services = await seedServices();
  admin = await makeUser("ADMIN");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("push notifications", () => {
  it("alerts only eligible, signed-in providers near a new request", async () => {
    const near = await makeApprovedProvider(admin.id);
    const offline = await makeApprovedProvider(admin.id);
    await prisma.providerProfile.update({ where: { userId: offline.id }, data: { isAvailable: false } });
    const far = await makeApprovedProvider(admin.id, { lat: 36.2021, lng: 37.1343 }); // Aleppo
    const wrongService = await makeApprovedProvider(admin.id, { services: ["battery"] });
    const loggedOut = await makeApprovedProvider(admin.id);

    const nearEndpoint = await subscribe(near.id, "near");
    await subscribe(offline.id, "offline");
    await subscribe(far.id, "far");
    await subscribe(wrongService.id, "wrong-service");
    await subscribe(loggedOut.id, "logged-out", { revoked: true });

    const customer = await makeUser();
    const request = await makeRequest(customer.id, services.mechanic.id);
    await settle();

    expect(sent.map((s) => s.endpoint)).toEqual([nearEndpoint]);
    expect(sent[0].payload.url).toBe(`/ar/provider/requests/${request.id}`);
  });

  it("tells the customer about a new offer and drops dead subscriptions", async () => {
    const provider = await makeApprovedProvider(admin.id, { lat: DAMASCUS.lat, lng: DAMASCUS.lng });
    const customer = await makeUser();
    const live = await subscribe(customer.id, "customer-phone");
    await subscribe(customer.id, "customer-gone");

    const request = await makeRequest(customer.id, services.mechanic.id);
    await settle();
    sent.length = 0;

    await submitOffer({ providerUserId: provider.id, input: offer(request.id) });
    await settle();

    expect(sent.map((s) => s.endpoint)).toEqual([live]);
    expect(sent[0].payload.url).toBe(`/ar/track/${request.trackingToken}`);
    expect(await prisma.pushSubscription.count({ where: { userId: customer.id } })).toBe(1);
  });
});
