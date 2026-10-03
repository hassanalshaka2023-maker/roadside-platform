/**
 * Web Push: storing subscriptions and sending to them.
 *
 * Payloads are encrypted end to end with each subscription's keys, so the
 * push service relaying them (Google, Apple, Mozilla) cannot read them. Still,
 * see ./messages.ts for what a notification is allowed to say.
 *
 * Sending is best effort and NEVER part of a business transaction: a phone
 * that is off, a revoked permission or a slow push service must not fail,
 * slow down or roll back a booking. Callers go through `notifyLater` in
 * ./events.ts, which runs after the response has been sent.
 */
import "server-only";

import webpush, { WebPushError } from "web-push";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { loggerFor } from "@/lib/logger";
import { buildPushPayload, normalizePushLocale, type PushEvent } from "./messages";

const log = loggerFor("notifications/push");

let configured = false;

export function isPushEnabled(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/** Safe to hand to the browser: it is the PUBLIC half of the key pair. */
export function vapidPublicKey(): string | null {
  return isPushEnabled() ? env.VAPID_PUBLIC_KEY! : null;
}

function configure(): boolean {
  if (!isPushEnabled()) return false;
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  return true;
}

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: string;
  userAgent?: string | null;
}

/**
 * Saves (or re-assigns) a device's subscription. Keyed by endpoint: if a
 * shared phone switches accounts, the device now belongs to whoever turned
 * notifications on last, so the previous user stops receiving alerts there.
 */
export async function saveSubscription(
  userId: string,
  sessionId: string,
  input: SubscriptionInput,
): Promise<void> {
  const data = {
    userId,
    sessionId,
    p256dh: input.p256dh,
    auth: input.auth,
    locale: normalizePushLocale(input.locale),
    userAgent: input.userAgent?.slice(0, 512) ?? null,
  };
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { endpoint: input.endpoint, ...data },
    update: data,
  });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/**
 * Sends one event to every signed-in device of these users, each in its own
 * language. Subscriptions the push service reports as gone are deleted.
 */
export async function sendToUsers(userIds: readonly string[], event: PushEvent): Promise<void> {
  if (userIds.length === 0 || !configure()) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      userId: { in: [...new Set(userIds)] },
      session: { revokedAt: null, expiresAt: { gt: new Date() } },
      user: { status: "ACTIVE", deletedAt: null },
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true, locale: true },
  });
  if (subscriptions.length === 0) return;

  const gone: string[] = [];
  const delivered: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      const payload = buildPushPayload(event, normalizePushLocale(sub.locale));
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          // A "new request" is useless an hour later; don't let the push
          // service deliver stale alerts when a phone comes back online.
          { TTL: 60 * 30, urgency: "high", timeout: 10_000 },
        );
        delivered.push(sub.id);
      } catch (error) {
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          gone.push(sub.id);
          return;
        }
        log.warn(
          { err: error, status: error instanceof WebPushError ? error.statusCode : undefined, event: event.type },
          "push delivery failed",
        );
      }
    }),
  );

  if (gone.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
  }
  if (delivered.length > 0) {
    await prisma.pushSubscription.updateMany({
      where: { id: { in: delivered } },
      data: { lastUsedAt: new Date() },
    });
  }

  log.info(
    { event: event.type, devices: subscriptions.length, delivered: delivered.length, removed: gone.length },
    "push sent",
  );
}
