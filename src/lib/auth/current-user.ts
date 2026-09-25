/**
 * Server-side authentication and authorization guards.
 *
 * ============================================================================
 * MIDDLEWARE ALONE IS NEVER SUFFICIENT.
 *
 * src/proxy.ts handles locale routing and friendly redirects only. It
 * runs before the route is resolved, it cannot query the database, and it is
 * easy to bypass with a crafted request. EVERY protected page, server action
 * and route handler must call one of the guards below itself.
 * ============================================================================
 */
import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { audit } from "../audit";
import { prisma } from "../db";
import { loggerFor } from "../logger";
import {
  can,
  type Permission,
  type PrincipalAdminLevel,
  type PrincipalRole,
} from "./permissions";
import { readSessionFromCookie, touchSession } from "./session";

const log = loggerFor("auth/guard");

export interface AuthUser {
  id: string;
  role: PrincipalRole;
  adminLevel: PrincipalAdminLevel | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Unverified number given by an email user, for providers to call. */
  contactPhone: string | null;
  isPhoneVerified: boolean;
}

/**
 * The current user, or null.
 *
 * Wrapped in React's `cache` so several guards in one render share a single
 * database round-trip, while still re-reading on the next request - the user's
 * status must be checked on EVERY request so that suspending or blocking
 * someone takes effect immediately rather than when their cookie expires.
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const session = await readSessionFromCookie();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      role: true,
      adminLevel: true,
      name: true,
      phone: true,
      email: true,
      contactPhone: true,
      isPhoneVerified: true,
      status: true,
      deletedAt: true,
    },
  });

  if (!user) return null;

  // Checked on every request, not only at login.
  if (user.deletedAt !== null) return null;
  if (user.status !== "ACTIVE") {
    log.warn({ userId: user.id, status: user.status }, "access denied: user not active");
    return null;
  }

  const authUser: AuthUser = {
    id: user.id,
    role: user.role,
    adminLevel: user.adminLevel,
    name: user.name,
    phone: user.phone,
    email: user.email,
    contactPhone: user.contactPhone,
    isPhoneVerified: user.isPhoneVerified,
  };

  await touchSession(session, user.role === "ADMIN");

  return authUser;
});

/** Where an unauthenticated visitor should be sent, by area. */
export type LoginArea = "customer" | "admin";

function loginPathFor(area: LoginArea, locale: string): string {
  return area === "admin" ? `/${locale}/admin/login` : `/${locale}/login`;
}

/**
 * Denies access to an authenticated-but-unauthorized user with a 404.
 *
 * Deliberately a 404 rather than a 403: a customer poking at /admin should
 * not have it confirmed that the route exists. The denial is recorded first,
 * so the audit trail still shows exactly what was attempted.
 */
async function deny(user: AuthUser, reason: string): Promise<never> {
  log.warn({ userId: user.id, role: user.role, reason }, "authorization denied");
  await audit({
    actorId: user.id,
    action: "rbac.denied",
    entityType: "route",
    metadata: { reason, role: user.role, adminLevel: user.adminLevel },
  });
  notFound();
}

/** Any signed-in user. Redirects to the login page when there is none. */
export async function requireUser(
  locale: string,
  area: LoginArea = "customer",
): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginPathFor(area, locale));
  return user;
}

/** Restricts to one or more roles. */
export async function requireRole(
  locale: string,
  roles: readonly PrincipalRole[],
  area: LoginArea = "customer",
): Promise<AuthUser> {
  const user = await requireUser(locale, area);
  if (!roles.includes(user.role)) {
    await deny(user, `role ${user.role} not in [${roles.join(", ")}]`);
  }
  return user;
}

/** Any admin, of any level. */
export async function requireAdmin(locale: string): Promise<AuthUser> {
  return requireRole(locale, ["ADMIN"], "admin");
}

/** A specific admin level - SUPER_ADMIN for settings and ID documents. */
export async function requireAdminLevel(
  locale: string,
  level: PrincipalAdminLevel,
): Promise<AuthUser> {
  const user = await requireAdmin(locale);
  if (user.adminLevel !== level) {
    await deny(user, `admin level ${user.adminLevel} is not ${level}`);
  }
  return user;
}

/**
 * The guard to reach for by default: ask for the capability, not the role.
 */
export async function requirePermission(
  locale: string,
  permission: Permission,
  area: LoginArea = "customer",
): Promise<AuthUser> {
  const user = await requireUser(locale, area);
  if (!can(user, permission)) {
    await deny(user, `missing permission ${permission}`);
  }
  return user;
}

/**
 * Guard for server actions and route handlers, where redirecting is wrong.
 * Throws instead, so the caller can return a typed error to the client.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export async function requirePermissionInAction(
  permission: Permission,
): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  if (!can(user, permission)) {
    log.warn({ userId: user.id, permission }, "action authorization denied");
    await audit({
      actorId: user.id,
      action: "rbac.denied",
      entityType: "action",
      metadata: { permission, role: user.role },
    });
    throw new ForbiddenError(permission);
  }
  return user;
}
