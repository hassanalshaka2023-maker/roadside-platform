"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { runAction, type ActionResult } from "@/lib/action-result";
import { readSessionFromCookie } from "@/lib/auth/session";
import { UnauthorizedError } from "@/lib/auth/current-user";
import { removeSubscription, saveSubscription } from "./push";

const base64url = z.string().min(8).max(256).regex(/^[A-Za-z0-9_-]+=*$/);

/** What the browser's PushSubscription.toJSON() gives us, plus the locale. */
const subscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({ p256dh: base64url, auth: base64url }),
  locale: z.enum(["ar", "en"]),
});

const endpointSchema = z.url({ protocol: /^https$/ }).max(2048);

export async function subscribePushAction(input: unknown): Promise<ActionResult> {
  return runAction(
    "viewOwnRequests",
    async ({ user }) => {
      const parsed = subscriptionSchema.parse(input);
      const session = await readSessionFromCookie();
      if (!session) throw new UnauthorizedError();

      await saveSubscription(user.id, session.sessionId, {
        endpoint: parsed.endpoint,
        p256dh: parsed.keys.p256dh,
        auth: parsed.keys.auth,
        locale: parsed.locale,
        userAgent: (await headers()).get("user-agent"),
      });
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}

export async function unsubscribePushAction(endpoint: unknown): Promise<ActionResult> {
  return runAction(
    "viewOwnRequests",
    async ({ user }) => {
      await removeSubscription(user.id, endpointSchema.parse(endpoint));
      return undefined;
    },
    { rateLimit: "mutationPerUser" },
  );
}
