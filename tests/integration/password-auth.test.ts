/**
 * Provider password sign-in and "forgot password", against the real database.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Sessions are cookie-backed; the store is faked, the session rows are real.
vi.mock("next/headers", () => {
  const jar = new Map<string, string>();
  return {
    cookies: async () => ({
      get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
      set: (name: string, value: string) => void jar.set(name, value),
      delete: (name: string) => void jar.delete(name),
    }),
    headers: async () => new Headers(),
  };
});

// A known code instead of a random one, so the test can type it in.
vi.mock("@/lib/crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crypto")>()),
  randomNumericCode: () => "123456",
}));

// Message rendering needs a Next.js request; the wording is not under test.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  completePasswordReset,
  passwordLogin,
  requestPasswordReset,
  setOwnPassword,
} from "@/lib/auth/password-login";
import { MemoryRateLimiter, rateLimiter } from "@/lib/rate-limit";
import { makeApprovedProvider, makeUser, resetDatabase, seedServices } from "./helpers";

let provider: Awaited<ReturnType<typeof makeApprovedProvider>>;
const PASSWORD = "correct horse battery";

beforeEach(async () => {
  // Each case starts with fresh attempt counters, as after a 15-minute wait.
  if (rateLimiter instanceof MemoryRateLimiter) rateLimiter.clear();
  await resetDatabase();
  await seedServices();
  const admin = await makeUser("ADMIN");
  provider = await makeApprovedProvider(admin.id);
  await prisma.user.update({
    where: { id: provider.id },
    data: { email: "provider@example.test", passwordHash: await hashPassword(PASSWORD) },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("password sign-in", () => {
  it("accepts the email or the verified phone with the right password", async () => {
    expect(await passwordLogin("Provider@Example.test", PASSWORD)).toMatchObject({ ok: true, role: "PROVIDER" });
    expect(await passwordLogin(provider.phone!, PASSWORD)).toMatchObject({ ok: true, role: "PROVIDER" });
    expect(await prisma.session.count({ where: { userId: provider.id } })).toBe(2);
  });

  it("gives one answer for a wrong password, an unknown account and an account without a password", async () => {
    const customer = await makeUser();
    const wrong = await passwordLogin("provider@example.test", "not the password");
    const unknown = await passwordLogin("nobody@example.test", PASSWORD);
    const noPassword = await passwordLogin(customer.phone!, PASSWORD);
    for (const result of [wrong, unknown, noPassword]) {
      expect(result).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    }
  });

  it("never lets a staff account in through this form", async () => {
    const admin = await prisma.user.create({
      data: { role: "ADMIN", adminLevel: "SUPER_ADMIN", email: "staff@example.test", passwordHash: await hashPassword(PASSWORD) },
    });
    expect(await passwordLogin("staff@example.test", PASSWORD)).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(0);
  });

  it("locks the account after repeated wrong passwords, even for the right one", async () => {
    for (let i = 0; i < 5; i += 1) await passwordLogin("provider@example.test", `wrong ${i}`);
    expect(await passwordLogin("provider@example.test", PASSWORD)).toMatchObject({ ok: false, reason: "LOCKED" });
  });
});

describe("forgot password", () => {
  it("resets with the emailed code, clears the lockout and signs out other devices", async () => {
    await passwordLogin("provider@example.test", PASSWORD); // an "other device"
    for (let i = 0; i < 5; i += 1) await passwordLogin("provider@example.test", `wrong ${i}`);

    const sent = await requestPasswordReset({ raw: "provider@example.test", locale: "ar", ip: null });
    expect(sent.ok).toBe(true);

    const done = await completePasswordReset({
      raw: "provider@example.test",
      code: "123456",
      password: "a brand new password",
      confirm: "a brand new password",
      ip: null,
      userAgent: null,
    });
    expect(done).toEqual({ ok: true, role: "PROVIDER" });

    const active = await prisma.session.count({ where: { userId: provider.id, revokedAt: null } });
    expect(active).toBe(1); // only the session opened by the reset itself
    expect(await passwordLogin("provider@example.test", "a brand new password")).toMatchObject({ ok: true });
    expect(await passwordLogin("provider@example.test", PASSWORD)).toMatchObject({ ok: false });
  });

  it("answers the same for an unknown address and sends nothing", async () => {
    const result = await requestPasswordReset({ raw: "nobody@example.test", locale: "ar", ip: null });
    expect(result.ok).toBe(true);
    expect(await prisma.otpCode.count({ where: { phone: "nobody@example.test" } })).toBe(0);
  });

  it("refuses a wrong code", async () => {
    await requestPasswordReset({ raw: "provider@example.test", locale: "ar", ip: null });
    const result = await completePasswordReset({
      raw: "provider@example.test",
      code: "000000",
      password: "a brand new password",
      confirm: "a brand new password",
      ip: null,
      userAgent: null,
    });
    expect(result).toMatchObject({ ok: false, errorKey: "otpErrors.INVALID_CODE" });
  });
});

describe("setting a password", () => {
  it("lets someone without a password set one, and asks for the old one to change it", async () => {
    const customer = await makeUser();
    expect(await setOwnPassword({ userId: customer.id, password: "first password", confirm: "first password" })).toEqual({ ok: true });
    expect(await setOwnPassword({ userId: customer.id, password: "second password", confirm: "second password" })).toEqual({
      ok: false,
      reason: "WRONG_CURRENT",
    });
    expect(
      await setOwnPassword({ userId: customer.id, currentPassword: "first password", password: "second password", confirm: "second password" }),
    ).toEqual({ ok: true });
  });
});
