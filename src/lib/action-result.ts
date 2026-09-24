/**
 * One shape for every server action's answer, and one wrapper that turns
 * exceptions into it.
 *
 * The wrapper is where technical failures and business refusals part ways:
 * a DomainError becomes its own message ("this offer has expired"), anything
 * else becomes the generic "something went wrong, try again" - never a
 * misleading business answer.
 */
import "server-only";

import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import { DomainError } from "@/features/requests/errors";
import { assertSameOrigin, CsrfError } from "./auth/csrf";
import {
  ForbiddenError,
  getCurrentUser,
  UnauthorizedError,
  type AuthUser,
} from "./auth/current-user";
import { can, type Permission } from "./auth/permissions";
import { loggerFor } from "./logger";
import { consumeLimit, type RateLimitName } from "./rate-limit";
import { getRequestContext } from "./request-context";

const log = loggerFor("actions");

export interface ActionResult<T = undefined> {
  ok: boolean;
  /** Translation key, e.g. "domainErrors.OFFER_EXPIRED". */
  errorKey?: string;
  errorValues?: Record<string, string | number>;
  data?: T;
}

export const EMPTY_RESULT: ActionResult = { ok: false };

export interface ActionContext {
  user: AuthUser;
  ip: string | null;
}

/**
 * Runs `fn` for a signed-in user holding `permission`, after the CSRF check
 * and an optional rate limit. Every mutation in the app goes through here.
 */
export async function runAction<T>(
  permission: Permission,
  fn: (ctx: ActionContext) => Promise<T>,
  options: { rateLimit?: RateLimitName } = {},
): Promise<ActionResult<T>> {
  try {
    await assertSameOrigin("POST");

    const user = await getCurrentUser();
    if (!user) throw new UnauthorizedError();
    if (!can(user, permission)) throw new ForbiddenError(permission);

    if (options.rateLimit) {
      const limit = await consumeLimit(options.rateLimit, user.id);
      if (!limit.allowed) {
        return {
          ok: false,
          errorKey: "domainErrors.RATE_LIMITED",
          errorValues: {
            seconds: Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)),
          },
        };
      }
    }

    const context = await getRequestContext();
    const data = await fn({ user, ip: context.ip });
    return { ok: true, data };
  } catch (error) {
    // redirect(), notFound() and friends are control flow, not failures.
    unstable_rethrow(error);
    return toErrorResult(error);
  }
}

export function toErrorResult(error: unknown): ActionResult<never> {
  if (error instanceof DomainError) {
    log.info({ code: error.code }, "action refused by business rule");
    return { ok: false, errorKey: `domainErrors.${error.code}` };
  }
  if (error instanceof ZodError) {
    const code = error.issues[0]?.message ?? "INVALID_INPUT";
    return { ok: false, errorKey: `validation.${/^[A-Z_]+$/.test(code) ? code : "INVALID_INPUT"}` };
  }
  if (error instanceof CsrfError) return { ok: false, errorKey: "errors.csrf" };
  if (error instanceof UnauthorizedError) return { ok: false, errorKey: "errors.unauthorized" };
  if (error instanceof ForbiddenError) return { ok: false, errorKey: "errors.forbidden" };

  log.error({ err: error }, "action failed");
  return { ok: false, errorKey: "errors.technical" };
}

// ---------------------------------------------------------------------------
// FormData helpers
// ---------------------------------------------------------------------------

export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function formBool(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

/** Whole amounts typed by people: "150,000", "١٥٠٠٠٠", "" -> 0. */
export function formAmount(formData: FormData, key: string): number {
  const raw = formString(formData, key)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s,،٬']/g, "");
  if (raw === "") return 0;
  return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

export function formInt(formData: FormData, key: string): number | undefined {
  const raw = formString(formData, key).trim();
  if (raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}
