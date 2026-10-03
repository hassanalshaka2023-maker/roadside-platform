"use client";

import { Download, Share, SquarePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";

/** Chrome/Edge/Samsung Internet's install event; not in the DOM typings yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Mode = "hidden" | "prompt" | "ios";

const DISMISS_KEY = "najda.installDismissedAt";
/** After "not now", ask again in two weeks rather than never. */
const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Private mode: the banner simply comes back next visit.
  }
}

/**
 * Invites the user to install the app on their home screen.
 *
 * - Android (Chrome, Samsung Internet, Edge): the browser's own install
 *   dialog, triggered by our button.
 * - iPhone/iPad: Safari has no install API, so the button opens short
 *   step-by-step instructions (Share -> Add to Home Screen).
 * - Already installed, or dismissed in the last two weeks: renders nothing.
 *
 * Once installed, the app opens full-screen from its own icon and keeps the
 * user signed in - the reason providers asked for an app.
 */
export function InstallAppBanner({ className }: { className?: string }) {
  const t = useTranslations("pwa");
  const tc = useTranslations("common");
  const [mode, setMode] = useState<Mode>("hidden");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- platform is only knowable on the client
    if (isIos()) setMode("ios");

    function onBeforeInstall(event: Event) {
      event.preventDefault(); // keep Chrome's mini-bar away; we show our own
      setDeferred(event as BeforeInstallPromptEvent);
      setMode("prompt");
    }
    function onInstalled() {
      setMode("hidden");
      setDeferred(null);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "hidden") return null;

  async function install() {
    if (mode === "ios") {
      setHelpOpen(true);
      return;
    }
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === "accepted") setMode("hidden");
  }

  function dismiss() {
    rememberDismissal();
    setMode("hidden");
  }

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border border-brand-yellow bg-brand-yellow-soft p-3",
          className,
        )}
      >
        <Download aria-hidden="true" className="h-6 w-6 shrink-0 text-ink" />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-ink">{t("title")}</p>
          <p className="text-sm text-gray-700">{t("text")}</p>
        </div>
        <Button size="sm" onClick={install}>
          {t("install")}
        </Button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("notNow")}
          className="min-h-touch min-w-touch shrink-0 rounded-lg text-gray-500 hover:bg-black/5"
        >
          <X aria-hidden="true" className="mx-auto h-5 w-5" />
        </button>
      </div>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={t("ios.title")} closeLabel={tc("close")}>
        <ol className="flex flex-col gap-4">
          <li className="flex items-start gap-3">
            <Share aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-blue-600" />
            <span>{t("ios.step1")}</span>
          </li>
          <li className="flex items-start gap-3">
            <SquarePlus aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" />
            <span>{t("ios.step2")}</span>
          </li>
          <li className="flex items-start gap-3">
            <Download aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" />
            <span>{t("ios.step3")}</span>
          </li>
        </ol>
        <p className="mt-4 rounded-lg bg-gray-100 p-3 text-sm text-gray-700">{t("ios.safariOnly")}</p>
        <Button fullWidth className="mt-4" onClick={() => setHelpOpen(false)}>
          {t("ios.done")}
        </Button>
      </Modal>
    </>
  );
}
