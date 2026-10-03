/**
 * "No offer yet? Call us." - when to show it. Pure, for unit tests.
 *
 * Counted from the start of the current search round, so "search again"
 * gives providers a fresh few minutes before the prompt returns.
 */
export function noOfferHelpDue(params: {
  status: string;
  offerCount: number;
  searchStartedAt: Date | null;
  createdAt: Date;
  minutes: number;
  now?: Date;
}): boolean {
  if (params.status !== "SEARCHING" || params.offerCount > 0) return false;
  const started = params.searchStartedAt ?? params.createdAt;
  const now = params.now ?? new Date();
  return now.getTime() - started.getTime() >= params.minutes * 60_000;
}
