"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import { InstallHelpModal, useInstallPrompt } from "./useInstallPrompt";

/**
 * Always-visible "Install the app" button, floating at the bottom on the
 * opposite side from the WhatsApp button. One tap opens the browser's
 * install dialog, or step-by-step help where there is none (iPhone, or a
 * browser inside WhatsApp/Facebook). Hidden once running as the app.
 */
export function InstallAppButton({ className }: { className?: string }) {
  const t = useTranslations("pwa");
  const { mode, install, helpOpen, closeHelp } = useInstallPrompt();

  if (mode === "unknown" || mode === "installed") return null;

  return (
    <>
      <button
        type="button"
        onClick={install}
        className={cn(
          "fixed bottom-4 start-4 z-40 inline-flex min-h-touch items-center gap-2 rounded-full bg-brand-yellow px-4 py-3 font-extrabold text-ink shadow-card transition-transform hover:scale-105",
          className,
        )}
      >
        <Download aria-hidden="true" className="h-5 w-5" />
        {t("installButton")}
      </button>
      <InstallHelpModal open={helpOpen} onClose={closeHelp} mode={mode} />
    </>
  );
}
