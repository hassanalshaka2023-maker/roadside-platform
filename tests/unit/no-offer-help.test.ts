import { describe, expect, it } from "vitest";

import { noOfferHelpDue } from "@/features/requests/no-offer-help";

const started = new Date("2026-10-04T10:00:00Z");
const at = (minutes: number) => new Date(started.getTime() + minutes * 60_000);
const base = { status: "SEARCHING", offerCount: 0, searchStartedAt: started, createdAt: started, minutes: 5 };

describe("noOfferHelpDue", () => {
  it("appears after five minutes of searching with no offer", () => {
    expect(noOfferHelpDue({ ...base, now: at(4.9) })).toBe(false);
    expect(noOfferHelpDue({ ...base, now: at(5) })).toBe(true);
  });

  it("stays away once an offer has arrived, or the search is over", () => {
    expect(noOfferHelpDue({ ...base, offerCount: 1, now: at(10) })).toBe(false);
    expect(noOfferHelpDue({ ...base, status: "CONFIRMED", now: at(10) })).toBe(false);
  });

  it("counts from the latest search round", () => {
    const restarted = at(30);
    expect(noOfferHelpDue({ ...base, searchStartedAt: restarted, now: at(32) })).toBe(false);
    expect(noOfferHelpDue({ ...base, searchStartedAt: null, now: at(6) })).toBe(true);
  });
});
