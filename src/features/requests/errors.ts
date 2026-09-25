/**
 * Business-rule refusals.
 *
 * Every refusal the user can meet has a stable code, and every code has an
 * Arabic sentence under `domainErrors.<CODE>` in messages/*.json. Server
 * actions catch DomainError and return the code; anything else is a bug and
 * becomes the generic error - so a technical failure is never dressed up as a
 * business answer such as "no provider available".
 */
export type DomainErrorCode =
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "CONCURRENT_UPDATE"
  | "ILLEGAL_TRANSITION"
  | "ID_REQUIRED"
  | "OUT_OF_COVERAGE"
  | "DESTINATION_REQUIRED"
  // offers
  | "NOT_ELIGIBLE"
  | "PROVIDER_BUSY"
  | "REQUEST_NOT_OPEN"
  | "OFFER_LIMIT_REACHED"
  | "OFFER_ALREADY_SENT"
  | "OFFER_NOT_AVAILABLE"
  | "OFFER_EXPIRED"
  | "ALREADY_BOOKED"
  | "FEE_TERMS_REQUIRED"
  | "INVALID_AMOUNT"
  // jobs
  | "EXTRA_PENDING"
  | "EXTRA_NOT_AVAILABLE"
  | "CALLOUT_NOT_DUE"
  | "FALLBACK_NOT_ALLOWED"
  // ratings, complaints
  | "ALREADY_RATED"
  | "NOT_RATEABLE"
  // applications
  | "APPLICATION_LOCKED"
  | "APPLICATION_INCOMPLETE"
  | "INVALID_DECISION"
  | "PROVIDER_ROLE_CONFLICT";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "DomainError";
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
