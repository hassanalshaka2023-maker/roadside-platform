/**
 * An admin changing their own sign-in email and/or password.
 *
 * The current password is required for any change: a stolen, still-open
 * session must not be enough to take the account over. Other sessions are
 * revoked afterwards; the one making the change stays signed in.
 */
import "server-only";

import { z } from "zod";

import { DomainError } from "@/features/requests/errors";
import { audit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { maskEmail, normalizeEmail } from "@/lib/email-address";

export const PASSWORD_MIN_LENGTH = 12;

export const accountChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "CURRENT_PASSWORD_REQUIRED").max(200),
    email: z.string().trim().max(254),
    newPassword: z.string().max(200),
    confirmPassword: z.string().max(200),
  })
  .refine((v) => v.newPassword === "" || v.newPassword.length >= PASSWORD_MIN_LENGTH, {
    message: "PASSWORD_TOO_SHORT",
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "PASSWORDS_DO_NOT_MATCH" })
  .refine((v) => v.email === "" || normalizeEmail(v.email) !== null, { message: "INVALID_EMAIL" });

export type AccountChangeInput = z.infer<typeof accountChangeSchema>;

export async function changeOwnCredentials(args: {
  userId: string;
  input: AccountChangeInput;
  keepSessionId: string | null;
  ip: string | null;
}): Promise<{ emailChanged: boolean; passwordChanged: boolean }> {
  const { userId, input } = args;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true, role: true },
  });
  if (!user || user.role !== "ADMIN" || !user.passwordHash) throw new DomainError("NOT_FOUND");

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new DomainError("WRONG_PASSWORD");
  }

  const newEmail = input.email === "" ? null : normalizeEmail(input.email);
  const emailChanged = newEmail !== null && newEmail !== user.email;
  const passwordChanged = input.newPassword !== "";
  if (!emailChanged && !passwordChanged) throw new DomainError("NOTHING_TO_CHANGE");

  if (emailChanged) {
    const taken = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
    if (taken) throw new DomainError("EMAIL_TAKEN");
  }

  const passwordHash = passwordChanged ? await hashPassword(input.newPassword) : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        ...(emailChanged ? { email: newEmail } : {}),
        ...(passwordHash ? { passwordHash, failedLoginCount: 0, lockedUntil: null } : {}),
      },
    });
    await tx.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(args.keepSessionId ? { id: { not: args.keepSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  });

  await audit({
    actorId: userId,
    action: "auth.admin.credentials.changed",
    entityType: "User",
    entityId: userId,
    metadata: {
      emailChanged,
      passwordChanged,
      ...(emailChanged && user.email ? { from: maskEmail(user.email), to: maskEmail(newEmail) } : {}),
    },
    ip: args.ip,
  });

  return { emailChanged, passwordChanged };
}
