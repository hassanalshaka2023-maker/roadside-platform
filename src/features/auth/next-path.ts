/**
 * Where to send someone after they sign in. Only a short list of our own
 * paths is accepted - never an arbitrary URL, which would be an open redirect.
 */
const ALLOWED = /^\/(apply|request|account(\/password)?|provider(\/[a-z0-9/-]*)?|track\/[A-Za-z0-9_-]{20,128})$/;

export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return ALLOWED.test(value) ? value : null;
}
