import { describe, expect, it } from "vitest";

import { buildPushPayload, normalizePushLocale, type PushEvent } from "@/features/notifications/messages";

const service = { nameAr: "سحب سيارة", nameEn: "Towing" };
const requestId = "11111111-1111-4111-8111-111111111111";
const trackingToken = "tok_abcdefghijklmnopqrstuvwxyz0123456789";

const EVENTS: PushEvent[] = [
  { type: "newRequest", requestId, service, governorate: "damascus" },
  { type: "invited", requestId, service, governorate: null },
  { type: "offerAccepted", requestId, publicCode: "RS-000042", service },
  { type: "bookingCancelled", requestId, publicCode: "RS-000042", by: "customer" },
  { type: "bookingCancelled", requestId, publicCode: "RS-000042", by: "admin" },
  { type: "extraAnswered", requestId, publicCode: "RS-000042", approved: true },
  { type: "extraAnswered", requestId, publicCode: "RS-000042", approved: false },
  { type: "completionAnswered", requestId, publicCode: "RS-000042", confirmed: true },
  { type: "completionAnswered", requestId, publicCode: "RS-000042", confirmed: false },
  { type: "newOffer", trackingToken, service, totalSyp: 150000, etaMinutes: 25 },
  { type: "onTheWay", trackingToken, etaMinutes: 12 },
  { type: "onTheWay", trackingToken, etaMinutes: null },
  { type: "arrived", trackingToken },
  { type: "awaitingConfirmation", trackingToken, amountSyp: 200000 },
  { type: "extraProposed", trackingToken, totalSyp: 50000 },
  { type: "providerWithdrew", trackingToken, searchingAgain: true },
  { type: "providerWithdrew", trackingToken, searchingAgain: false },
  { type: "searchEnded", trackingToken, anyOffers: true },
  { type: "searchEnded", trackingToken, anyOffers: false },
];

describe("buildPushPayload", () => {
  it.each(["ar", "en"] as const)("has real text and a local link for every event (%s)", (locale) => {
    for (const event of EVENTS) {
      const payload = buildPushPayload(event, locale);
      expect(payload.title, event.type).not.toMatch(/push\.|\{|\}/);
      expect(payload.body, event.type).not.toMatch(/push\.|\{|\}/);
      expect(payload.title.length, event.type).toBeGreaterThan(3);
      expect(payload.url.startsWith(`/${locale}/`), event.type).toBe(true);
      expect(payload.tag.length, event.type).toBeGreaterThan(0);
    }
  });

  it("sends providers to the request, and customers to their tracking page", () => {
    expect(buildPushPayload(EVENTS[0], "ar").url).toBe(`/ar/provider/requests/${requestId}`);
    expect(buildPushPayload(EVENTS[2], "en").url).toBe(`/en/provider/jobs/${requestId}`);
    expect(buildPushPayload(EVENTS[9], "ar").url).toBe(`/ar/track/${trackingToken}`);
  });

  it("fills in service, area and money in the reader's language", () => {
    const ar = buildPushPayload(EVENTS[0], "ar");
    expect(ar.body).toContain("سحب سيارة");
    expect(ar.body).toContain("دمشق");

    const en = buildPushPayload(EVENTS[9], "en");
    expect(en.body).toContain("Towing");
    expect(en.body).toContain("SYP 150,000");
    expect(en.body).toContain("25");
  });

  it("falls back to Arabic for unknown locales", () => {
    expect(normalizePushLocale("fr")).toBe("ar");
    expect(normalizePushLocale(null)).toBe("ar");
    expect(normalizePushLocale("en")).toBe("en");
  });
});
