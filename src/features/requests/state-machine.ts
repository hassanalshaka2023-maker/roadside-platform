/**
 * The request lifecycle, as a state machine.
 *
 * Transitions are enforced by the SERVER and every transition is logged. This
 * module is the enforcement half: it answers "may this actor move this request
 * from A to B?" and nothing else.
 *
 * Pure and dependency-free on purpose - no Prisma, no session, no i18n - so
 * the rules can be exhaustively unit tested, and so there is exactly one place
 * to read when arguing about what the lifecycle allows.
 *
 * Happy path (hybrid dispatch, see docs/STATUS.md):
 *
 *   SEARCHING -> CONFIRMED -> ON_THE_WAY -> ARRIVED -> IN_PROGRESS
 *             -> AWAITING_CONFIRMATION -> COMPLETED
 *
 * Offers and extra charges are separate records, not states, so the main
 * lifecycle stays small.
 */

export type RequestStatusName =
  | "SEARCHING"
  | "CONFIRMED"
  | "ON_THE_WAY"
  | "ARRIVED"
  | "IN_PROGRESS"
  | "AWAITING_CONFIRMATION"
  | "COMPLETED"
  | "DISPUTED"
  | "CANCELLED_BY_CUSTOMER"
  | "CANCELLED_BY_PROVIDER"
  | "CANCELLED_BY_ADMIN"
  | "NO_PROVIDER_AVAILABLE"
  | "EXPIRED";

/**
 * Who is attempting the transition.
 *
 * Deliberately NOT the same as a role: the provider booked on this request is
 * a different actor from any other provider, and that distinction is the
 * whole point of `resolveActor` below.
 */
export type TransitionActor =
  /** The customer who owns the request. */
  | "CUSTOMER"
  /** The provider currently booked on this request. */
  | "ASSIGNED_PROVIDER"
  /** Any admin who may dispatch (DISPATCHER or SUPER_ADMIN). */
  | "ADMIN"
  /** Automated: the search-timeout sweep. */
  | "SYSTEM";

interface Transition {
  to: RequestStatusName;
  by: readonly TransitionActor[];
}

/**
 * Allowed moves out of each state. An empty array means TERMINAL.
 */
const TRANSITIONS: Record<RequestStatusName, readonly Transition[]> = {
  SEARCHING: [
    // The customer accepts an offer. An admin may do it for a customer who
    // confirmed by phone - the action is audited with the admin's name.
    { to: "CONFIRMED", by: ["CUSTOMER", "ADMIN"] },
    { to: "NO_PROVIDER_AVAILABLE", by: ["SYSTEM", "ADMIN"] },
    { to: "EXPIRED", by: ["SYSTEM"] },
    { to: "CANCELLED_BY_CUSTOMER", by: ["CUSTOMER"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  CONFIRMED: [
    { to: "ON_THE_WAY", by: ["ASSIGNED_PROVIDER"] },
    // The provider cannot come after all, or an admin reassigns: the request
    // goes back to the pool rather than dying.
    { to: "SEARCHING", by: ["ASSIGNED_PROVIDER", "ADMIN"] },
    { to: "CANCELLED_BY_CUSTOMER", by: ["CUSTOMER"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  ON_THE_WAY: [
    { to: "ARRIVED", by: ["ASSIGNED_PROVIDER"] },
    { to: "SEARCHING", by: ["ASSIGNED_PROVIDER", "ADMIN"] },
    // No cancellation fee by default: none has been agreed with anyone.
    { to: "CANCELLED_BY_CUSTOMER", by: ["CUSTOMER"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  ARRIVED: [
    { to: "IN_PROGRESS", by: ["ASSIGNED_PROVIDER"] },
    // Straight to settlement: the customer declined the repair after the
    // inspection, so only the agreed callout fee is due.
    { to: "AWAITING_CONFIRMATION", by: ["ASSIGNED_PROVIDER"] },
    { to: "CANCELLED_BY_PROVIDER", by: ["ASSIGNED_PROVIDER"] },
    // Once someone is standing next to the car, the customer can no longer
    // walk away alone: an admin has to look at it.
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  IN_PROGRESS: [
    { to: "AWAITING_CONFIRMATION", by: ["ASSIGNED_PROVIDER"] },
    // "I cannot finish this job."
    { to: "CANCELLED_BY_PROVIDER", by: ["ASSIGNED_PROVIDER"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  AWAITING_CONFIRMATION: [
    // The provider's word alone never completes a request.
    { to: "COMPLETED", by: ["CUSTOMER", "ADMIN"] },
    { to: "DISPUTED", by: ["CUSTOMER"] },
    // Pressed "done" too early.
    { to: "IN_PROGRESS", by: ["ASSIGNED_PROVIDER"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  DISPUTED: [
    { to: "COMPLETED", by: ["ADMIN"] },
    { to: "CANCELLED_BY_ADMIN", by: ["ADMIN"] },
  ],

  // Not terminal: the customer can search again from where they are.
  NO_PROVIDER_AVAILABLE: [
    { to: "SEARCHING", by: ["CUSTOMER", "ADMIN"] },
    { to: "CANCELLED_BY_CUSTOMER", by: ["CUSTOMER"] },
  ],
  EXPIRED: [
    { to: "SEARCHING", by: ["CUSTOMER", "ADMIN"] },
    { to: "CANCELLED_BY_CUSTOMER", by: ["CUSTOMER"] },
  ],

  // --- terminal ------------------------------------------------------------
  COMPLETED: [],
  CANCELLED_BY_CUSTOMER: [],
  CANCELLED_BY_PROVIDER: [],
  CANCELLED_BY_ADMIN: [],
};

export const ALL_STATUSES = Object.keys(TRANSITIONS) as RequestStatusName[];

/** States from which nothing can move. */
export const TERMINAL_STATUSES: readonly RequestStatusName[] = ALL_STATUSES.filter(
  (status) => TRANSITIONS[status].length === 0,
);

/** A provider is booked and the job is under way. */
export const ACTIVE_JOB_STATUSES: readonly RequestStatusName[] = [
  "CONFIRMED",
  "ON_THE_WAY",
  "ARRIVED",
  "IN_PROGRESS",
  "AWAITING_CONFIRMATION",
];

/** The search ended without anyone booked, and can be restarted. */
export const SEARCH_ENDED_STATUSES: readonly RequestStatusName[] = [
  "NO_PROVIDER_AVAILABLE",
  "EXPIRED",
];

export function isTerminal(status: RequestStatusName): boolean {
  return TRANSITIONS[status].length === 0;
}

export function isActiveJob(status: RequestStatusName): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
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

export type TransitionRefusal = "TERMINAL" | "NOT_ALLOWED" | "WRONG_ACTOR" | "SAME_STATUS";

export type TransitionCheck = { ok: true } | { ok: false; reason: TransitionRefusal };

/**
 * The single authority on whether a move is legal. A wrong actor is reported
 * separately from an impossible move, so the caller can give a useful error.
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
  if (!result.ok) throw new IllegalTransitionError(from, to, actor, result.reason);
}

// ---------------------------------------------------------------------------
// Helpers the UI and service layer share
// ---------------------------------------------------------------------------

/**
 * Works out which actor a given user is FOR A GIVEN REQUEST.
 *
 * A provider who is not booked on this request is not an actor on it at all.
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
  // One account can be both; a provider looking at their own broken-down car
  // is the customer.
  if (userId === requestCustomerId) return "CUSTOMER";

  return null;
}

export function customerCanCancel(status: RequestStatusName): boolean {
  return canTransition(status, "CANCELLED_BY_CUSTOMER", "CUSTOMER");
}

/** The happy path, for rendering a progress timeline. */
export const PROGRESS_SEQUENCE: readonly RequestStatusName[] = [
  "SEARCHING",
  "CONFIRMED",
  "ON_THE_WAY",
  "ARRIVED",
  "IN_PROGRESS",
  "AWAITING_CONFIRMATION",
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

/**
 * Whether the booked provider (and only they) may see the customer's exact
 * location and phone number right now. Before booking and after the job, the
 * provider sees the area and an approximate distance only.
 */
export function providerSeesContactDetails(status: RequestStatusName): boolean {
  return isActiveJob(status);
}
