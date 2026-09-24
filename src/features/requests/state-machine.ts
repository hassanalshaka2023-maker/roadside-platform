/**
 * The request lifecycle, as a state machine.
 *
 * CLAUDE.md requires that transitions are enforced by the SERVER and that
 * every transition is logged. This module is the enforcement half: it answers
 * "may this actor move this request from A to B?" and nothing else.
 *
 * Pure and dependency-free on purpose - no Prisma, no session, no i18n - so
 * the rules can be exhaustively unit tested without a database, and so there
 * is exactly one place to read when arguing about what the lifecycle allows.
 *
 * The whole machine is defined now even though phase 3 only uses creation and
 * customer cancellation; phases 4 and 5 build directly on this.
 */

export type RequestStatusName =
  | "PENDING"
  | "ASSIGNED"
  | "ACCEPTED"
  | "ON_THE_WAY"
  | "ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED_BY_CUSTOMER"
  | "CANCELLED_BY_ADMIN"
  | "DECLINED"
  | "NO_PROVIDER_AVAILABLE";

/**
 * Who is attempting the transition.
 *
 * Deliberately NOT the same as a role: the provider assigned to this request
 * is a different actor from some other provider, and that distinction is the
 * whole point of `resolveActor` below.
 */
export type TransitionActor =
  /** The customer who owns the request. */
  | "CUSTOMER"
  /** The provider currently assigned to this request. */
  | "ASSIGNED_PROVIDER"
  /** Any admin who may dispatch (DISPATCHER or SUPER_ADMIN). */
  | "ADMIN"
  /** Automated: the retention job, a timeout sweep, the seed. */
  | "SYSTEM";

interface Transition {
  to: RequestStatusName;
  /** Actors permitted to make this move. */
  by: readonly TransitionActor[];
}

/**
 * Allowed moves out of each state.
 *
 * A state with an empty array is TERMINAL: nothing moves out of it, ever.
 * Reopening a cancelled or completed request would make the history lie about
 * what happened, so a new request is created instead.
 */
const TRANSITIONS: Record<RequestStatusName, readonly Transition[]> = {
  PENDING: [
    { to: "ASSIGNED", by: ["ADMIN"] },
    { to: "NO_PROVIDER_AVAILABLE", by: ["ADMIN", "SYSTEM"] },
    { to: "CANCELLED_BY_CUSTOMER", by: ["CUSTOMER"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  ASSIGNED: [
    { to: "ACCEPTED", by: ["ASSIGNED_PROVIDER"] },
    // The provider says no - back to the dispatcher, who reassigns.
    { to: "DECLINED", by: ["ASSIGNED_PROVIDER"] },
    // Reassignment: the dispatcher pulls it back to try someone else.
    { to: "PENDING", by: ["ADMIN"] },
    { to: "CANCELLED_BY_CUSTOMER", by: ["CUSTOMER"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  ACCEPTED: [
    { to: "ON_THE_WAY", by: ["ASSIGNED_PROVIDER"] },
    { to: "CANCELLED_BY_CUSTOMER", by: ["CUSTOMER"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  ON_THE_WAY: [
    { to: "ARRIVED", by: ["ASSIGNED_PROVIDER"] },
    // Still cancellable by the customer, but this is where a cancellation
    // fee conversation would eventually live.
    { to: "CANCELLED_BY_CUSTOMER", by: ["CUSTOMER"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  ARRIVED: [
    { to: "IN_PROGRESS", by: ["ASSIGNED_PROVIDER"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  IN_PROGRESS: [
    { to: "COMPLETED", by: ["ASSIGNED_PROVIDER"] },
    // Once work has started the customer can no longer walk away alone; an
    // admin has to intervene, because there is now a bill to settle.
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  // --- terminal ------------------------------------------------------------
  COMPLETED: [],
  CANCELLED_BY_CUSTOMER: [],
  CANCELLED_BY_ADMIN: [],
  DECLINED: [],
  NO_PROVIDER_AVAILABLE: [],
};

/** States from which nothing can move. */
export const TERMINAL_STATUSES: readonly RequestStatusName[] = (
  Object.keys(TRANSITIONS) as RequestStatusName[]
).filter((status) => TRANSITIONS[status].length === 0);

export function isTerminal(status: RequestStatusName): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Every status this actor could move the request to right now. */
export function allowedTransitions(
  from: RequestStatusName,
  actor: TransitionActor,
): readonly RequestStatusName[] {
  return TRANSITIONS[from]
    .filter((transition) => transition.by.includes(actor))
    .map((transition) => transition.to);
}

/** Every status reachable from `from`, regardless of who is asking. */
export function reachableFrom(
  from: RequestStatusName,
): readonly RequestStatusName[] {
  return TRANSITIONS[from].map((transition) => transition.to);
}

export type TransitionRefusal =
  | "TERMINAL"
  | "NOT_ALLOWED"
  | "WRONG_ACTOR"
  | "SAME_STATUS";

export type TransitionCheck =
  | { ok: true }
  | { ok: false; reason: TransitionRefusal };

/**
 * The single authority on whether a move is legal.
 *
 * Note that a wrong actor is reported separately from an impossible move:
 * the caller can then say "a provider cannot do that" rather than "that is
 * impossible", which is the difference between a useful error and a confusing
 * one.
 */
export function checkTransition(
  from: RequestStatusName,
  to: RequestStatusName,
  actor: TransitionActor,
): TransitionCheck {
  if (from === to) return { ok: false, reason: "SAME_STATUS" };
  if (isTerminal(from)) return { ok: false, reason: "TERMINAL" };

  const transition = TRANSITIONS[from].find((candidate) => candidate.to === to);
  if (!transition) return { ok: false, reason: "NOT_ALLOWED" };
  if (!transition.by.includes(actor)) return { ok: false, reason: "WRONG_ACTOR" };

  return { ok: true };
}

export function canTransition(
  from: RequestStatusName,
  to: RequestStatusName,
  actor: TransitionActor,
): boolean {
  return checkTransition(from, to, actor).ok;
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: RequestStatusName,
    readonly to: RequestStatusName,
    readonly actor: TransitionActor,
    readonly reason: TransitionRefusal,
  ) {
    super(`Illegal transition ${from} -> ${to} by ${actor} (${reason})`);
    this.name = "IllegalTransitionError";
  }
}

/** Throwing variant, for the service layer. */
export function assertTransition(
  from: RequestStatusName,
  to: RequestStatusName,
  actor: TransitionActor,
): void {
  const result = checkTransition(from, to, actor);
  if (!result.ok) {
    throw new IllegalTransitionError(from, to, actor, result.reason);
  }
}

// ---------------------------------------------------------------------------
// Helpers the UI and service layer share
// ---------------------------------------------------------------------------

/**
 * Works out which actor a given user is FOR A GIVEN REQUEST.
 *
 * This is where "a provider" becomes "the assigned provider": a provider who
 * is not assigned to this request is not an actor on it at all.
 */
export function resolveActor(params: {
  userId: string;
  role: "CUSTOMER" | "PROVIDER" | "ADMIN";
  requestCustomerId: string;
  requestAssignedProviderId: string | null;
}): TransitionActor | null {
  const { userId, role, requestCustomerId, requestAssignedProviderId } = params;

  if (role === "ADMIN") return "ADMIN";
  if (role === "PROVIDER" && requestAssignedProviderId === userId) {
    return "ASSIGNED_PROVIDER";
  }
  // Checked after the provider case: one account can be both, and when a
  // provider is looking at their own broken-down car they are the customer.
  if (userId === requestCustomerId) return "CUSTOMER";

  return null;
}

/** True while the customer is still allowed to call it off themselves. */
export function customerCanCancel(status: RequestStatusName): boolean {
  return canTransition(status, "CANCELLED_BY_CUSTOMER", "CUSTOMER");
}

/**
 * The happy path, for rendering a progress timeline. Cancellations and
 * declines are deliberately absent: they are not steps forward.
 */
export const PROGRESS_SEQUENCE: readonly RequestStatusName[] = [
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "ON_THE_WAY",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
];

/** Position in PROGRESS_SEQUENCE, or -1 for a status that left the path. */
export function progressIndex(status: RequestStatusName): number {
  return PROGRESS_SEQUENCE.indexOf(status);
}

/** True for a status that ended the request without completing it. */
export function isUnsuccessfulEnd(status: RequestStatusName): boolean {
  return isTerminal(status) && status !== "COMPLETED";
}
