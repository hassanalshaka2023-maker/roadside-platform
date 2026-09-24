import { describe, expect, it } from "vitest";

import {
  allowedTransitions,
  assertTransition,
  canTransition,
  checkTransition,
  customerCanCancel,
  IllegalTransitionError,
  isTerminal,
  isUnsuccessfulEnd,
  progressIndex,
  PROGRESS_SEQUENCE,
  reachableFrom,
  resolveActor,
  TERMINAL_STATUSES,
  type RequestStatusName,
  type TransitionActor,
} from "@/features/requests/state-machine";

const ALL_STATUSES: RequestStatusName[] = [
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "ON_THE_WAY",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED_BY_CUSTOMER",
  "CANCELLED_BY_ADMIN",
  "DECLINED",
  "NO_PROVIDER_AVAILABLE",
];

const ALL_ACTORS: TransitionActor[] = [
  "CUSTOMER",
  "ASSIGNED_PROVIDER",
  "ADMIN",
  "SYSTEM",
];

describe("terminal states", () => {
  it("are exactly the five ends of the lifecycle", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      [
        "CANCELLED_BY_ADMIN",
        "CANCELLED_BY_CUSTOMER",
        "COMPLETED",
        "DECLINED",
        "NO_PROVIDER_AVAILABLE",
      ].sort(),
    );
  });

  it("let NOBODY move out, whatever they try", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of ALL_STATUSES) {
        for (const actor of ALL_ACTORS) {
          expect(canTransition(from, to, actor)).toBe(false);
        }
      }
    }
  });

  it("report TERMINAL rather than a vague refusal", () => {
    const result = checkTransition("COMPLETED", "IN_PROGRESS", "ADMIN");
    expect(result).toEqual({ ok: false, reason: "TERMINAL" });
  });

  it("a completed request cannot be reopened even by an admin", () => {
    // Reopening would make the history lie; a new request is the answer.
    expect(canTransition("COMPLETED", "PENDING", "ADMIN")).toBe(false);
  });
});

describe("the happy path", () => {
  it("walks PENDING to COMPLETED with the right actor at each step", () => {
    expect(canTransition("PENDING", "ASSIGNED", "ADMIN")).toBe(true);
    expect(canTransition("ASSIGNED", "ACCEPTED", "ASSIGNED_PROVIDER")).toBe(true);
    expect(canTransition("ACCEPTED", "ON_THE_WAY", "ASSIGNED_PROVIDER")).toBe(true);
    expect(canTransition("ON_THE_WAY", "ARRIVED", "ASSIGNED_PROVIDER")).toBe(true);
    expect(canTransition("ARRIVED", "IN_PROGRESS", "ASSIGNED_PROVIDER")).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETED", "ASSIGNED_PROVIDER")).toBe(true);
  });

  it("cannot be skipped", () => {
    expect(canTransition("PENDING", "COMPLETED", "ADMIN")).toBe(false);
    expect(canTransition("PENDING", "ON_THE_WAY", "ASSIGNED_PROVIDER")).toBe(false);
    expect(canTransition("ACCEPTED", "COMPLETED", "ASSIGNED_PROVIDER")).toBe(false);
    expect(canTransition("ASSIGNED", "ARRIVED", "ASSIGNED_PROVIDER")).toBe(false);
  });

  it("cannot run backwards", () => {
    expect(canTransition("ARRIVED", "ON_THE_WAY", "ASSIGNED_PROVIDER")).toBe(false);
    expect(canTransition("IN_PROGRESS", "ACCEPTED", "ASSIGNED_PROVIDER")).toBe(false);
  });
});

describe("actor rules", () => {
  it("a customer cannot dispatch", () => {
    const result = checkTransition("PENDING", "ASSIGNED", "CUSTOMER");
    expect(result).toEqual({ ok: false, reason: "WRONG_ACTOR" });
  });

  it("a provider cannot dispatch to themselves", () => {
    expect(canTransition("PENDING", "ASSIGNED", "ASSIGNED_PROVIDER")).toBe(false);
  });

  it("an admin cannot drive the job on the provider's behalf", () => {
    // The admin is not at the roadside; only the provider knows they arrived.
    expect(canTransition("ACCEPTED", "ON_THE_WAY", "ADMIN")).toBe(false);
    expect(canTransition("ARRIVED", "IN_PROGRESS", "ADMIN")).toBe(false);
    expect(canTransition("IN_PROGRESS", "COMPLETED", "ADMIN")).toBe(false);
  });

  it("a customer cannot mark their own request completed", () => {
    expect(canTransition("IN_PROGRESS", "COMPLETED", "CUSTOMER")).toBe(false);
  });

  it("only the provider may decline", () => {
    expect(canTransition("ASSIGNED", "DECLINED", "ASSIGNED_PROVIDER")).toBe(true);
    expect(canTransition("ASSIGNED", "DECLINED", "ADMIN")).toBe(false);
    expect(canTransition("ASSIGNED", "DECLINED", "CUSTOMER")).toBe(false);
  });

  it("distinguishes a wrong actor from an impossible move", () => {
    // Both are refusals, but they need different messages.
    expect(checkTransition("PENDING", "ASSIGNED", "CUSTOMER").ok).toBe(false);
    expect(checkTransition("PENDING", "ASSIGNED", "CUSTOMER")).toMatchObject({
      reason: "WRONG_ACTOR",
    });
    expect(checkTransition("PENDING", "ARRIVED", "ADMIN")).toMatchObject({
      reason: "NOT_ALLOWED",
    });
  });
});

describe("cancellation", () => {
  it("the customer may cancel while nobody has started work", () => {
    expect(customerCanCancel("PENDING")).toBe(true);
    expect(customerCanCancel("ASSIGNED")).toBe(true);
    expect(customerCanCancel("ACCEPTED")).toBe(true);
    expect(customerCanCancel("ON_THE_WAY")).toBe(true);
  });

  it("the customer may NOT cancel once the provider is there or working", () => {
    // There is a bill to settle by then; an admin has to be involved.
    expect(customerCanCancel("ARRIVED")).toBe(false);
    expect(customerCanCancel("IN_PROGRESS")).toBe(false);
  });

  it("an admin can cancel at any live stage", () => {
    for (const status of [
      "PENDING",
      "ASSIGNED",
      "ACCEPTED",
      "ON_THE_WAY",
      "ARRIVED",
      "IN_PROGRESS",
    ] as const) {
      expect(canTransition(status, "CANCELLED_BY_ADMIN", "ADMIN")).toBe(true);
    }
  });

  it("nobody can cancel a request that already ended", () => {
    expect(customerCanCancel("COMPLETED")).toBe(false);
    expect(canTransition("CANCELLED_BY_ADMIN", "CANCELLED_BY_CUSTOMER", "CUSTOMER")).toBe(
      false,
    );
  });
});

describe("dispatch loops", () => {
  it("a declined request goes back to the pool", () => {
    // DECLINED is terminal for THIS assignment; the dispatcher creates the
    // next attempt by pulling ASSIGNED back to PENDING instead.
    expect(canTransition("ASSIGNED", "PENDING", "ADMIN")).toBe(true);
  });

  it("an admin can mark that nobody is available", () => {
    expect(canTransition("PENDING", "NO_PROVIDER_AVAILABLE", "ADMIN")).toBe(true);
    expect(canTransition("PENDING", "NO_PROVIDER_AVAILABLE", "SYSTEM")).toBe(true);
    expect(canTransition("PENDING", "NO_PROVIDER_AVAILABLE", "CUSTOMER")).toBe(false);
  });
});

describe("invariants across the whole machine", () => {
  it("never allows a transition to itself", () => {
    for (const status of ALL_STATUSES) {
      for (const actor of ALL_ACTORS) {
        expect(checkTransition(status, status, actor)).toEqual({
          ok: false,
          reason: "SAME_STATUS",
        });
      }
    }
  });

  it("allowedTransitions is always a subset of reachableFrom", () => {
    for (const status of ALL_STATUSES) {
      const reachable = reachableFrom(status);
      for (const actor of ALL_ACTORS) {
        for (const target of allowedTransitions(status, actor)) {
          expect(reachable).toContain(target);
        }
      }
    }
  });

  it("every allowed transition actually passes checkTransition", () => {
    for (const status of ALL_STATUSES) {
      for (const actor of ALL_ACTORS) {
        for (const target of allowedTransitions(status, actor)) {
          expect(canTransition(status, target, actor)).toBe(true);
        }
      }
    }
  });

  it("SYSTEM cannot quietly drive the whole lifecycle", () => {
    // An automated sweep should only ever mark "nobody available".
    const systemMoves = ALL_STATUSES.flatMap((status) =>
      allowedTransitions(status, "SYSTEM"),
    );
    expect([...new Set(systemMoves)]).toEqual(["NO_PROVIDER_AVAILABLE"]);
  });

  it("every non-terminal state has somewhere to go", () => {
    for (const status of ALL_STATUSES) {
      if (isTerminal(status)) continue;
      expect(reachableFrom(status).length).toBeGreaterThan(0);
    }
  });
});

describe("assertTransition", () => {
  it("passes silently when legal", () => {
    expect(() => assertTransition("PENDING", "ASSIGNED", "ADMIN")).not.toThrow();
  });

  it("throws with the reason attached", () => {
    try {
      assertTransition("PENDING", "COMPLETED", "CUSTOMER");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      const illegal = error as IllegalTransitionError;
      expect(illegal.from).toBe("PENDING");
      expect(illegal.to).toBe("COMPLETED");
      expect(illegal.reason).toBe("NOT_ALLOWED");
    }
  });
});

describe("resolveActor", () => {
  const base = {
    requestCustomerId: "customer-1",
    requestAssignedProviderId: "provider-1",
  };

  it("recognises the owning customer", () => {
    expect(
      resolveActor({ ...base, userId: "customer-1", role: "CUSTOMER" }),
    ).toBe("CUSTOMER");
  });

  it("recognises the assigned provider", () => {
    expect(
      resolveActor({ ...base, userId: "provider-1", role: "PROVIDER" }),
    ).toBe("ASSIGNED_PROVIDER");
  });

  it("gives an UNASSIGNED provider no standing at all", () => {
    // The core reason this function exists.
    expect(
      resolveActor({ ...base, userId: "provider-2", role: "PROVIDER" }),
    ).toBeNull();
  });

  it("gives an unrelated customer no standing", () => {
    expect(
      resolveActor({ ...base, userId: "customer-2", role: "CUSTOMER" }),
    ).toBeNull();
  });

  it("treats any admin as ADMIN", () => {
    expect(resolveActor({ ...base, userId: "admin-1", role: "ADMIN" })).toBe("ADMIN");
  });

  it("treats a provider looking at their OWN broken car as the customer", () => {
    // One account per phone number: a tow-truck driver's own car breaks down.
    expect(
      resolveActor({
        userId: "provider-1",
        role: "PROVIDER",
        requestCustomerId: "provider-1",
        requestAssignedProviderId: null,
      }),
    ).toBe("CUSTOMER");
  });

  it("prefers ASSIGNED_PROVIDER when the same person is somehow both", () => {
    expect(
      resolveActor({
        userId: "provider-1",
        role: "PROVIDER",
        requestCustomerId: "provider-1",
        requestAssignedProviderId: "provider-1",
      }),
    ).toBe("ASSIGNED_PROVIDER");
  });
});

describe("progress helpers", () => {
  it("orders the happy path", () => {
    expect(progressIndex("PENDING")).toBe(0);
    expect(progressIndex("COMPLETED")).toBe(PROGRESS_SEQUENCE.length - 1);
    expect(progressIndex("ON_THE_WAY")).toBeGreaterThan(progressIndex("ACCEPTED"));
  });

  it("returns -1 for statuses that left the path", () => {
    expect(progressIndex("CANCELLED_BY_CUSTOMER")).toBe(-1);
    expect(progressIndex("DECLINED")).toBe(-1);
  });

  it("identifies unsuccessful ends", () => {
    expect(isUnsuccessfulEnd("COMPLETED")).toBe(false);
    expect(isUnsuccessfulEnd("CANCELLED_BY_CUSTOMER")).toBe(true);
    expect(isUnsuccessfulEnd("NO_PROVIDER_AVAILABLE")).toBe(true);
    expect(isUnsuccessfulEnd("PENDING")).toBe(false);
  });
});
