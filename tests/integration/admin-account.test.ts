/**
 * An admin changing their own email and password.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { accountChangeSchema, changeOwnCredentials } from "@/features/admin/account";
import { DomainError } from "@/features/requests/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { resetDatabase } from "./helpers";

const CURRENT = "current-password-123";

async function makeAdmin(email = `${randomUUID()}@test.local`) {
  return prisma.user.create({
    data: { role: "ADMIN", adminLevel: "SUPER_ADMIN", email, name: "admin", passwordHash: await hashPassword(CURRENT) },
  });
}

async function makeSession(userId: string) {
  return prisma.session.create({
    data: { userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
  });
}

function input(overrides: Partial<Record<"currentPassword" | "email" | "newPassword" | "confirmPassword", string>>) {
  return accountChangeSchema.parse({ currentPassword: CURRENT, email: "", newPassword: "", confirmPassword: "", ...overrides });
}

async function expectDomainError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error: unknown) => error instanceof DomainError && error.code === code);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("changeOwnCredentials", () => {
  it("changes email and password, keeps this session and revokes the others", async () => {
    const admin = await makeAdmin();
    const here = await makeSession(admin.id);
    const elsewhere = await makeSession(admin.id);

    const result = await changeOwnCredentials({
      userId: admin.id,
      input: input({ email: " New.Owner@Example.com ", newPassword: "a-brand-new-password", confirmPassword: "a-brand-new-password" }),
      keepSessionId: here.id,
      ip: null,
    });

    expect(result).toEqual({ emailChanged: true, passwordChanged: true });
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(updated.email).toBe("new.owner@example.com");
    expect(await verifyPassword(updated.passwordHash!, "a-brand-new-password")).toBe(true);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: here.id } })).revokedAt).toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: elsewhere.id } })).revokedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "auth.admin.credentials.changed" } })).toBe(1);
  });

  it("refuses a wrong current password and changes nothing", async () => {
    const admin = await makeAdmin();
    await expectDomainError(
      changeOwnCredentials({ userId: admin.id, input: input({ currentPassword: "wrong-password", email: "x@example.com" }), keepSessionId: null, ip: null }),
      "WRONG_PASSWORD",
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).email).toBe(admin.email);
  });

  it("refuses an email another account uses", async () => {
    const admin = await makeAdmin();
    const other = await makeAdmin("taken@example.com");
    await expectDomainError(
      changeOwnCredentials({ userId: admin.id, input: input({ email: other.email! }), keepSessionId: null, ip: null }),
      "EMAIL_TAKEN",
    );
  });

  it("refuses an empty change", async () => {
    const admin = await makeAdmin();
    await expectDomainError(
      changeOwnCredentials({ userId: admin.id, input: input({ email: admin.email! }), keepSessionId: null, ip: null }),
      "NOTHING_TO_CHANGE",
    );
  });

  it("validates the new password before touching the database", () => {
    expect(() => input({ newPassword: "short", confirmPassword: "short" })).toThrow("PASSWORD_TOO_SHORT");
    expect(() => input({ newPassword: "long-enough-password", confirmPassword: "different-password" })).toThrow("PASSWORDS_DO_NOT_MATCH");
    expect(() => input({ email: "not-an-email" })).toThrow("INVALID_EMAIL");
  });
});
