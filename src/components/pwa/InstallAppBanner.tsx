"use client";

import { Download, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { InstallHelpModal, useInstallPrompt } from "./useInstallPrompt";

const DISMISS_KEY = "najda.installDismissedAt";
/** After "not now", ask again in two weeks rather than never. */
const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;

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
 * A card inviting the user to install the app on their home screen
 * (provider area and account page). The always-visible floating button is
 * <InstallAppButton />; this card adds the "why" and can be dismissed.
 *
 * Once installed, the app opens full-screen from its own icon and keeps the
 * user signed in - the reason providers asked for an app.
 */
export function InstallAppBanner({ className }: { className?: string }) {
  const t = useTranslations("pwa");
  const { mode, install, helpOpen, closeHelp } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable on the client
    setDismissed(recentlyDismissed());
  }, []);

  // Only where installing is likely to work right away; the floating button
  // still covers everyone else.
  if (dismissed || (mode !== "prompt" && mode !== "ios")) return null;

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
          onClick={() => {
            rememberDismissal();
            setDismissed(true);
          }}
          aria-label={t("notNow")}
          className="min-h-touch min-w-touch shrink-0 rounded-lg text-gray-500 hover:bg-black/5"
        >
          <X aria-hidden="true" className="mx-auto h-5 w-5" />
        </button>
      </div>
      <InstallHelpModal open={helpOpen} onClose={closeHelp} mode={mode} />
    </>
  );
}
