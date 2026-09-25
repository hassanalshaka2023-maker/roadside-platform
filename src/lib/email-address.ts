/**
 * Email address helpers. Pure, safe on server and client.
 */

/** Deliberately simple: one @, a dot in the domain, no spaces. The real
 *  proof that an address works is the code we send to it. */
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value.length > 254 || !EMAIL.test(value)) return null;
  return value;
}

export function isEmailDestination(destination: string): boolean {
  return destination.includes("@");
}

/** "ahmad@gmail.com" -> "a***@gmail.com", for logs and screens. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}
