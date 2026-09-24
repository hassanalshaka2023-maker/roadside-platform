import { describe, expect, it } from "vitest";

import {
  ACTIVE_JOB_STATUSES,
  ALL_STATUSES,
  allowedTransitions,
  assertTransition,
  canTransition,
  checkTransition,
  customerCanCancel,
  IllegalTransitionError,
  isTerminal,
  progressIndex,
  providerSeesContactDetails,
  resolveActor,
  TERMINAL_STATUSES,
  type RequestStatusName,
  type TransitionActor,
} from "@/features/requests/state-machine";

const ACTORS: TransitionActor[] = ["CUSTOMER", "ASSIGNED_PROVIDER", "ADMIN", "SYSTEM"];

describe("terminal states", () => {
  it("are exactly completed and the three cancellations", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      ["CANCELLED_BY_ADMIN", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_PROVIDER", "COMPLETED"].sort(),
    );
  });

  it("allow no move by anyone", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of ALL_STATUSES) {
        for (const actor of ACTORS) {
          expect(canTransition(from, to, actor)).toBe(false);
        }
      }
    }
  });

  it("report TERMINAL rather than NOT_ALLOWED", () => {
    expect(checkTransition("COMPLETED", "SEARCHING", "ADMIN")).toEqual({ ok: false, reason: "TERMINAL" });
  });

  it("do not include the ends of a search, which can be restarted", () => {
    expect(isTerminal("NO_PROVIDER_AVAILABLE")).toBe(false);
    expect(isTerminal("EXPIRED")).toBe(false);
    expect(canTransition("NO_PROVIDER_AVAILABLE", "SEARCHING", "CUSTOMER")).toBe(true);
    expect(canTransition("EXPIRED", "SEARCHING", "CUSTOMER")).toBe(true);
  });
});

describe("the happy path", () => {
  const steps: Array<[RequestStatusName, RequestStatusName, TransitionActor]> = [
    ["SEARCHING", "CONFIRMED", "CUSTOMER"],
    ["CONFIRMED", "ON_THE_WAY", "ASSIGNED_PROVIDER"],
    ["ON_THE_WAY", "ARRIVED", "ASSIGNED_PROVIDER"],
    ["ARRIVED", "IN_PROGRESS", "ASSIGNED_PROVIDER"],
    ["IN_PROGRESS", "AWAITING_CONFIRMATION", "ASSIGNED_PROVIDER"],
    ["AWAITING_CONFIRMATION", "COMPLETED", "CUSTOMER"],
  ];

  it.each(steps)("%s -> %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true);
  });

  it("advances the progress index at every step", () => {
    for (const [from, to] of steps) {
      expect(progressIndex(to)).toBeGreaterThan(progressIndex(from));
    }
  });
});

describe("completion needs the customer", () => {
  it("cannot be completed by the provider alone", () => {
    expect(canTransition("AWAITING_CONFIRMATION", "COMPLETED", "ASSIGNED_PROVIDER")).toBe(false);
    expect(canTransition("IN_PROGRESS", "COMPLETED", "ASSIGNED_PROVIDER")).toBe(false);
    expect(canTransition("ARRIVED", "COMPLETED", "ASSIGNED_PROVIDER")).toBe(false);
  });

  it("lets the customer dispute instead of confirming", () => {
    expect(canTransition("AWAITING_CONFIRMATION", "DISPUTED", "CUSTOMER")).toBe(true);
    expect(canTransition("AWAITING_CONFIRMATION", "DISPUTED", "ASSIGNED_PROVIDER")).toBe(false);
  });

  it("sends disputes to admins only", () => {
    expect(allowedTransitions("DISPUTED", "ADMIN")).toEqual(["COMPLETED", "CANCELLED_BY_ADMIN"]);
    expect(allowedTransitions("DISPUTED", "CUSTOMER")).toEqual([]);
    expect(allowedTransitions("DISPUTED", "ASSIGNED_PROVIDER")).toEqual([]);
  });
});

describe("who may do what", () => {
  it("never lets the system book, complete or cancel", () => {
    for (const from of ALL_STATUSES) {
      expect(canTransition(from, "CONFIRMED", "SYSTEM")).toBe(false);
      expect(canTransition(from, "COMPLETED", "SYSTEM")).toBe(false);
      expect(canTransition(from, "CANCELLED_BY_ADMIN", "SYSTEM")).toBe(false);
    }
  });

  it("gives the system only the two search endings", () => {
    expect(allowedTransitions("SEARCHING", "SYSTEM")).toEqual(["NO_PROVIDER_AVAILABLE", "EXPIRED"]);
  });

  it("reports WRONG_ACTOR for a legal move by the wrong person", () => {
    expect(checkTransition("CONFIRMED", "ON_THE_WAY", "CUSTOMER")).toEqual({ ok: false, reason: "WRONG_ACTOR" });
  });

  it("does not let the provider accept on the customer's behalf", () => {
    expect(canTransition("SEARCHING", "CONFIRMED", "ASSIGNED_PROVIDER")).toBe(false);
  });

  it("lets the booked provider drop out before arrival, back to searching", () => {
    expect(canTransition("CONFIRMED", "SEARCHING", "ASSIGNED_PROVIDER")).toBe(true);
    expect(canTransition("ON_THE_WAY", "SEARCHING", "ASSIGNED_PROVIDER")).toBe(true);
    expect(canTransition("ARRIVED", "SEARCHING", "ASSIGNED_PROVIDER")).toBe(false);
  });
});

describe("customer cancellation", () => {
  it("is free before arrival", () => {
    for (const status of ["SEARCHING", "CONFIRMED", "ON_THE_WAY"] as const) {
      expect(customerCanCancel(status)).toBe(true);
    }
  });

  it("is not possible alone once the provider has arrived", () => {
    for (const status of ["ARRIVED", "IN_PROGRESS", "AWAITING_CONFIRMATION"] as const) {
      expect(customerCanCancel(status)).toBe(false);
    }
  });
});

describe("assertTransition", () => {
  it("throws a typed error with the reason", () => {
    expect(() => assertTransition("SEARCHING", "COMPLETED", "CUSTOMER")).toThrow(IllegalTransitionError);
    try {
      assertTransition("SEARCHING", "SEARCHING", "ADMIN");
    } catch (error) {
      expect((error as IllegalTransitionError).reason).toBe("SAME_STATUS");
    }
  });
});

describe("resolveActor", () => {
  const base = { requestCustomerId: "c1", requestAssignedProviderId: "p1" };

  it("recognises the booked provider only", () => {
    expect(resolveActor({ ...base, userId: "p1", role: "PROVIDER" })).toBe("ASSIGNED_PROVIDER");
    expect(resolveActor({ ...base, userId: "p2", role: "PROVIDER" })).toBeNull();
  });

  it("treats a provider's own request as a customer's", () => {
    expect(resolveActor({ ...base, userId: "c1", role: "PROVIDER" })).toBe("CUSTOMER");
  });

  it("gives strangers no role at all", () => {
    expect(resolveActor({ ...base, userId: "x", role: "CUSTOMER" })).toBeNull();
  });

  it("maps any admin to ADMIN", () => {
    expect(resolveActor({ ...base, userId: "a", role: "ADMIN" })).toBe("ADMIN");
  });
});

describe("contact details", () => {
  it("are visible to the booked provider only during an active job", () => {
    for (const status of ALL_STATUSES) {
      expect(providerSeesContactDetails(status)).toBe(ACTIVE_JOB_STATUSES.includes(status));
    }
    expect(providerSeesContactDetails("SEARCHING")).toBe(false);
    expect(providerSeesContactDetails("COMPLETED")).toBe(false);
  });
});
