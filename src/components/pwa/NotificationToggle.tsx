"use client";

import { Bell, BellOff, BellRing } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { subscribePushAction, unsubscribePushAction } from "@/features/notifications/actions";
import { cn } from "@/lib/cn";

type State = "hidden" | "unsupported" | "iosInstall" | "denied" | "off" | "on";

/** The VAPID public key is base64url; the Push API wants raw bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return false;
  const left = new Uint8Array(a);
  return left.length === b.length && left.every((v, i) => v === b[i]);
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * "Turn on notifications" for this device.
 *
 * - The permission prompt only ever opens from a tap, never on page load:
 *   browsers punish sites that ask unprompted, and a refused prompt cannot be
 *   asked again.
 * - iPhone supports web push only inside the installed app, so there the
 *   card explains that first.
 * - A device that is already subscribed re-sends its subscription on load,
 *   which re-binds it to the current sign-in (see PushSubscription.sessionId).
 *
 * Renders nothing when push is not configured on the server (no key), and in
 * development, where the service worker is not registered.
 */
export function NotificationToggle({
  publicKey,
  audience,
  className,
}: {
  publicKey: string | null;
  audience: "provider" | "customer";
  className?: string;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const [state, setState] = useState<State>("hidden");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const synced = useRef(false);

  useEffect(() => {
    if (!publicKey || process.env.NODE_ENV !== "production") return;
    let cancelled = false;

    async function detect() {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        setState(isIos() && !isStandalone() ? "iosInstall" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (cancelled) return;

      if (existing && Notification.permission === "granted") {
        setState("on");
        if (!synced.current) {
          synced.current = true;
          void subscribePushAction({ ...existing.toJSON(), locale });
        }
      } else {
        setState("off");
      }
    }

    detect().catch(() => setState("unsupported"));
    return () => {
      cancelled = true;
    };
  }, [publicKey, locale]);

  if (state === "hidden" || !publicKey) return null;

  async function enable() {
    setBusy(true);
    setFailed(false);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const key = keyBytes(publicKey!);

      // A subscription made with an older server key would never deliver.
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

      const result = await subscribePushAction({ ...subscription.toJSON(), locale });
      if (!result.ok) throw new Error(result.errorKey);
      setState("on");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setFailed(false);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribePushAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const Icon = state === "on" ? BellRing : state === "denied" || state === "unsupported" ? BellOff : Bell;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border p-3",
        state === "on" ? "border-green-300 bg-green-50" : "border-gray-200 bg-white",
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("h-6 w-6 shrink-0", state === "on" ? "text-green-700" : "text-ink")} />
      <div className="min-w-0 flex-1">
        <p className="font-extrabold text-ink">{t("title")}</p>
        <p className="text-sm text-gray-700" role={failed ? "alert" : undefined}>
          {failed
            ? t("failed")
            : state === "on"
              ? t("enabled")
              : state === "denied"
                ? t("denied")
                : state === "iosInstall"
                  ? t("iosInstallFirst")
                  : state === "unsupported"
                    ? t("unsupported")
                    : audience === "provider"
                      ? t("providerText")
                      : t("customerText")}
        </p>
      </div>
      {state === "off" && (
        <Button size="sm" onClick={enable} isLoading={busy} loadingLabel={t("enable")}>
          {t("enable")}
        </Button>
      )}
      {state === "on" && (
        <Button size="sm" variant="ghost" onClick={disable} isLoading={busy} loadingLabel={t("disable")}>
          {t("disable")}
        </Button>
      )}
    </div>
  );
}
