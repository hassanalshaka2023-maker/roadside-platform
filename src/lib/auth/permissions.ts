/**
 * The single source of truth for "who may do what".
 *
 * Call sites ask for a permission, never for a role:
 *
 *     if (!can(user, "viewIdDocuments")) ...
 *
 * so that when a role is added or split later, only this file changes.
 *
 * This module is pure and has no imports with side effects, which keeps it
 * directly unit-testable and safe to import from anywhere.
 */

/** Mirrors the Prisma enums. Declared locally so this file stays dependency-free. */
export type PrincipalRole = "CUSTOMER" | "PROVIDER" | "ADMIN";
export type PrincipalAdminLevel = "SUPER_ADMIN" | "DISPATCHER";

export interface Principal {
  role: PrincipalRole;
  adminLevel?: PrincipalAdminLevel | null;
}

export const PERMISSIONS = [
  // --- customer -----------------------------------------------------------
  "createRequest",
  "viewOwnRequests",
  "cancelOwnRequest",
  "rateProvider",

  // --- provider -----------------------------------------------------------
  "viewAssignedJobs",
  "updateJobStatus",
  "updateOwnAvailability",

  // --- admin: dispatch ----------------------------------------------------
  "viewAllRequests",
  "dispatchRequests",
  "cancelAnyRequest",
  "viewCustomers",
  "viewProviders",

  // --- admin: vetting and administration ----------------------------------
  "viewProviderApplications",
  "reviewProviderApplications",
  "manageProviders",
  "manageServiceTypes",
  "manageSettings",
  "manageAdmins",
  "viewAuditLog",
  "exportData",

  /**
   * The most sensitive permission in the system: opening a scan of someone's
   * national ID. SUPER_ADMIN only, and every use is written to AuditLog.
   */
  "viewIdDocuments",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const CUSTOMER_PERMISSIONS = [
  "createRequest",
  "viewOwnRequests",
  "cancelOwnRequest",
  "rateProvider",
] as const satisfies readonly Permission[];

/**
 * A provider is also a customer: one account per phone number, so a tow-truck
 * driver can request help for his own car.
 * See docs/adr/001-identity-model.md.
 */
const PROVIDER_PERMISSIONS = [
  ...CUSTOMER_PERMISSIONS,
  "viewAssignedJobs",
  "updateJobStatus",
  "updateOwnAvailability",
] as const satisfies readonly Permission[];

/**
 * "Requests and dispatch only" (CLAUDE.md). A dispatcher can see and move
 * requests and can see the people involved in them, but cannot open ID
 * documents, vet applications, or change any configuration.
 */
const DISPATCHER_PERMISSIONS = [
  "viewAllRequests",
  "dispatchRequests",
  "cancelAnyRequest",
  "viewCustomers",
  "viewProviders",
] as const satisfies readonly Permission[];

/** Everything, without exception. */
const SUPER_ADMIN_PERMISSIONS = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  CUSTOMER: CUSTOMER_PERMISSIONS,
  PROVIDER: PROVIDER_PERMISSIONS,
  "ADMIN:DISPATCHER": DISPATCHER_PERMISSIONS,
  "ADMIN:SUPER_ADMIN": SUPER_ADMIN_PERMISSIONS,
};

/** The key into ROLE_PERMISSIONS for a given principal. */
function principalKey(principal: Principal): string {
  if (principal.role === "ADMIN") {
    // An ADMIN row with no level is a data bug. Fail closed: no permissions.
    return principal.adminLevel ? `ADMIN:${principal.adminLevel}` : "ADMIN:NONE";
  }
  return principal.role;
}

export function permissionsFor(principal: Principal): readonly Permission[] {
  return ROLE_PERMISSIONS[principalKey(principal)] ?? [];
}

/** The one function call sites should use. */
export function can(
  principal: Principal | null | undefined,
  permission: Permission,
): boolean {
  if (!principal) return false;
  return permissionsFor(principal).includes(permission);
}

export function canAny(
  principal: Principal | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => can(principal, permission));
}

export function canAll(
  principal: Principal | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => can(principal, permission));
}

export function isAdmin(principal: Principal | null | undefined): boolean {
  return principal?.role === "ADMIN";
}

export function isSuperAdmin(principal: Principal | null | undefined): boolean {
  return principal?.role === "ADMIN" && principal.adminLevel === "SUPER_ADMIN";
}
