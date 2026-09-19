import { describe, expect, it } from "vitest";

import {
  can,
  canAll,
  canAny,
  isAdmin,
  isSuperAdmin,
  PERMISSIONS,
  permissionsFor,
  type Principal,
} from "@/lib/auth/permissions";

const CUSTOMER: Principal = { role: "CUSTOMER" };
const PROVIDER: Principal = { role: "PROVIDER" };
const DISPATCHER: Principal = { role: "ADMIN", adminLevel: "DISPATCHER" };
const SUPER_ADMIN: Principal = { role: "ADMIN", adminLevel: "SUPER_ADMIN" };

describe("SUPER_ADMIN", () => {
  it("holds every declared permission", () => {
    for (const permission of PERMISSIONS) {
      expect(can(SUPER_ADMIN, permission)).toBe(true);
    }
  });

  it("can view ID documents and manage settings", () => {
    expect(can(SUPER_ADMIN, "viewIdDocuments")).toBe(true);
    expect(can(SUPER_ADMIN, "manageSettings")).toBe(true);
  });
});

describe("DISPATCHER", () => {
  it("can work with requests and dispatch", () => {
    expect(can(DISPATCHER, "viewAllRequests")).toBe(true);
    expect(can(DISPATCHER, "dispatchRequests")).toBe(true);
    expect(can(DISPATCHER, "cancelAnyRequest")).toBe(true);
  });

  it("CANNOT view ID documents", () => {
    // The single most important negative case in the whole permission map.
    expect(can(DISPATCHER, "viewIdDocuments")).toBe(false);
  });

  it("CANNOT change settings or manage admins", () => {
    expect(can(DISPATCHER, "manageSettings")).toBe(false);
    expect(can(DISPATCHER, "manageAdmins")).toBe(false);
  });

  it("cannot vet provider applications", () => {
    expect(can(DISPATCHER, "viewProviderApplications")).toBe(false);
    expect(can(DISPATCHER, "reviewProviderApplications")).toBe(false);
  });

  it("holds strictly fewer permissions than a super admin", () => {
    expect(permissionsFor(DISPATCHER).length).toBeLessThan(
      permissionsFor(SUPER_ADMIN).length,
    );
  });
});

describe("CUSTOMER", () => {
  it("can act on their own requests", () => {
    expect(can(CUSTOMER, "createRequest")).toBe(true);
    expect(can(CUSTOMER, "viewOwnRequests")).toBe(true);
    expect(can(CUSTOMER, "cancelOwnRequest")).toBe(true);
    expect(can(CUSTOMER, "rateProvider")).toBe(true);
  });

  it("has no admin or provider powers at all", () => {
    expect(can(CUSTOMER, "viewAllRequests")).toBe(false);
    expect(can(CUSTOMER, "dispatchRequests")).toBe(false);
    expect(can(CUSTOMER, "viewIdDocuments")).toBe(false);
    expect(can(CUSTOMER, "viewAssignedJobs")).toBe(false);
  });
});

describe("PROVIDER", () => {
  it("can handle assigned jobs", () => {
    expect(can(PROVIDER, "viewAssignedJobs")).toBe(true);
    expect(can(PROVIDER, "updateJobStatus")).toBe(true);
    expect(can(PROVIDER, "updateOwnAvailability")).toBe(true);
  });

  it("is also a customer: one account per phone number", () => {
    expect(can(PROVIDER, "createRequest")).toBe(true);
    expect(can(PROVIDER, "viewOwnRequests")).toBe(true);
  });

  it("has no admin powers", () => {
    expect(can(PROVIDER, "viewAllRequests")).toBe(false);
    expect(can(PROVIDER, "viewIdDocuments")).toBe(false);
  });
});

describe("failing closed", () => {
  it("denies everything to a null principal", () => {
    for (const permission of PERMISSIONS) {
      expect(can(null, permission)).toBe(false);
      expect(can(undefined, permission)).toBe(false);
    }
  });

  it("denies everything to an ADMIN with no level (a data bug)", () => {
    const broken: Principal = { role: "ADMIN", adminLevel: null };
    expect(permissionsFor(broken)).toEqual([]);
    expect(can(broken, "viewAllRequests")).toBe(false);
    expect(can(broken, "viewIdDocuments")).toBe(false);
  });
});

describe("helpers", () => {
  it("canAny needs one match", () => {
    expect(canAny(DISPATCHER, ["viewIdDocuments", "dispatchRequests"])).toBe(true);
    expect(canAny(DISPATCHER, ["viewIdDocuments", "manageSettings"])).toBe(false);
  });

  it("canAll needs every match", () => {
    expect(canAll(SUPER_ADMIN, ["viewIdDocuments", "manageSettings"])).toBe(true);
    expect(canAll(DISPATCHER, ["dispatchRequests", "manageSettings"])).toBe(false);
  });

  it("identifies admins and super admins", () => {
    expect(isAdmin(DISPATCHER)).toBe(true);
    expect(isAdmin(CUSTOMER)).toBe(false);
    expect(isSuperAdmin(SUPER_ADMIN)).toBe(true);
    expect(isSuperAdmin(DISPATCHER)).toBe(false);
  });
});
