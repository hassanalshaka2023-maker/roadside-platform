import { describe, expect, it } from "vitest";

import {
  canUploadKind,
  canViewFile,
  ID_DOCUMENT_KINDS,
  isIdDocument,
  type FileKindName,
} from "@/lib/files/access";

const OWNER = { id: "user-owner", role: "CUSTOMER" as const };
const OTHER_CUSTOMER = { id: "user-other", role: "CUSTOMER" as const };
const PROVIDER = { id: "user-provider", role: "PROVIDER" as const };
const DISPATCHER = {
  id: "user-dispatcher",
  role: "ADMIN" as const,
  adminLevel: "DISPATCHER" as const,
};
const SUPER_ADMIN = {
  id: "user-super",
  role: "ADMIN" as const,
  adminLevel: "SUPER_ADMIN" as const,
};

const PHOTO_KINDS: FileKindName[] = ["REQUEST_PHOTO", "EQUIPMENT_PHOTO", "VEHICLE_PHOTO"];

describe("isIdDocument", () => {
  it("covers the three identity kinds and the tow-truck ownership document", () => {
    expect(ID_DOCUMENT_KINDS).toEqual(["ID_FRONT", "ID_BACK", "SELFIE", "VEHICLE_DOCUMENT"]);
    expect(isIdDocument("VEHICLE_DOCUMENT")).toBe(true);
    expect(isIdDocument("VEHICLE_PHOTO")).toBe(false);
    expect(isIdDocument("ID_FRONT")).toBe(true);
    expect(isIdDocument("SELFIE")).toBe(true);
    expect(isIdDocument("REQUEST_PHOTO")).toBe(false);
  });
});

describe("anonymous visitors", () => {
  it("are refused every kind, with ANONYMOUS so the route can return 401", () => {
    for (const kind of [...ID_DOCUMENT_KINDS, ...PHOTO_KINDS]) {
      expect(canViewFile({ viewer: null, ownerId: OWNER.id, kind })).toEqual({
        allowed: false,
        reason: "ANONYMOUS",
      });
    }
  });
});

describe("identity documents", () => {
  it("are visible ONLY to a holder of viewIdDocuments", () => {
    for (const kind of ID_DOCUMENT_KINDS) {
      expect(canViewFile({ viewer: SUPER_ADMIN, ownerId: OWNER.id, kind })).toEqual({
        allowed: true,
        mustAudit: true,
      });
    }
  });

  it("are NOT visible to a dispatcher", () => {
    // The single most important negative case in the whole phase.
    for (const kind of ID_DOCUMENT_KINDS) {
      expect(canViewFile({ viewer: DISPATCHER, ownerId: OWNER.id, kind })).toEqual({
        allowed: false,
        reason: "FORBIDDEN",
      });
    }
  });

  it("are NOT visible to the owner who uploaded them", () => {
    // Deliberate: once uploaded, the customer only ever sees "uploaded".
    for (const kind of ID_DOCUMENT_KINDS) {
      expect(canViewFile({ viewer: OWNER, ownerId: OWNER.id, kind })).toEqual({
        allowed: false,
        reason: "FORBIDDEN",
      });
    }
  });

  it("are NOT visible to another customer or to a provider", () => {
    for (const viewer of [OTHER_CUSTOMER, PROVIDER]) {
      expect(
        canViewFile({ viewer, ownerId: OWNER.id, kind: "ID_FRONT" }),
      ).toEqual({ allowed: false, reason: "FORBIDDEN" });
    }
  });

  it("ALWAYS require an audit entry, even for a super admin viewing their own", () => {
    const decision = canViewFile({
      viewer: SUPER_ADMIN,
      ownerId: SUPER_ADMIN.id,
      kind: "ID_BACK",
    });
    expect(decision).toEqual({ allowed: true, mustAudit: true });
  });
});

describe("request and equipment photos", () => {
  it("are visible to their owner, without an audit entry", () => {
    for (const kind of PHOTO_KINDS) {
      expect(canViewFile({ viewer: OWNER, ownerId: OWNER.id, kind })).toEqual({
        allowed: true,
        mustAudit: false,
      });
    }
  });

  it("are visible to a dispatcher - they need to see the damaged car", () => {
    for (const kind of PHOTO_KINDS) {
      expect(canViewFile({ viewer: DISPATCHER, ownerId: OWNER.id, kind })).toEqual({
        allowed: true,
        mustAudit: false,
      });
    }
  });

  it("are visible to a super admin", () => {
    expect(
      canViewFile({ viewer: SUPER_ADMIN, ownerId: OWNER.id, kind: "REQUEST_PHOTO" }),
    ).toMatchObject({ allowed: true });
  });

  it("are NOT visible to an unrelated customer", () => {
    for (const kind of PHOTO_KINDS) {
      expect(
        canViewFile({ viewer: OTHER_CUSTOMER, ownerId: OWNER.id, kind }),
      ).toEqual({ allowed: false, reason: "FORBIDDEN" });
    }
  });

  it("are NOT visible to an unrelated provider", () => {
    expect(
      canViewFile({ viewer: PROVIDER, ownerId: OWNER.id, kind: "REQUEST_PHOTO" }),
    ).toEqual({ allowed: false, reason: "FORBIDDEN" });
  });

  it("stay private when the owning account was deleted", () => {
    // ownerId null must not accidentally match a viewer with no id.
    expect(
      canViewFile({ viewer: OTHER_CUSTOMER, ownerId: null, kind: "REQUEST_PHOTO" }),
    ).toEqual({ allowed: false, reason: "FORBIDDEN" });
  });
});

describe("failing closed", () => {
  it("denies an ADMIN row with no level", () => {
    const broken = { id: "broken", role: "ADMIN" as const, adminLevel: null };

    expect(canViewFile({ viewer: broken, ownerId: OWNER.id, kind: "ID_FRONT" })).toEqual(
      { allowed: false, reason: "FORBIDDEN" },
    );
    expect(
      canViewFile({ viewer: broken, ownerId: OWNER.id, kind: "REQUEST_PHOTO" }),
    ).toEqual({ allowed: false, reason: "FORBIDDEN" });
  });
});

describe("canUploadKind", () => {
  it("allows any signed-in user to upload any kind", () => {
    for (const kind of [...ID_DOCUMENT_KINDS, ...PHOTO_KINDS]) {
      expect(canUploadKind(OWNER, kind)).toBe(true);
    }
  });

  it("refuses anonymous uploads", () => {
    expect(canUploadKind(null, "ID_FRONT")).toBe(false);
  });

  it("refuses a kind that is not in the uploadable list", () => {
    expect(canUploadKind(OWNER, "NOT_A_KIND" as FileKindName)).toBe(false);
  });
});
