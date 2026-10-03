"use client";

import { Download, EllipsisVertical, Share, SquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/** Chrome/Edge/Samsung Internet's install event; not in the DOM typings yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * - "installed": already running as the installed app - show nothing.
 * - "prompt": the browser can install with one tap.
 * - "ios": iPhone/iPad - Safari's Share -> Add to Home Screen.
 * - "manual": anything else (browser menu, or open in Chrome first).
 * - "unknown": not on the client yet.
 */
export type InstallMode = "unknown" | "installed" | "prompt" | "ios" | "manual";

// The browser fires beforeinstallprompt once per page load, possibly before
// a component that wants it has mounted. Keep it at module level so every
// install button on the page shares it.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let listening = false;

function listenOnce() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // keep Chrome's mini-bar away; we show our own
    deferredPrompt = event as BeforeInstallPromptEvent;
    listeners.forEach((notify) => notify());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    listeners.forEach((notify) => notify());
  });
}

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

function currentMode(): InstallMode {
  if (isStandalone()) return "installed";
  if (deferredPrompt) return "prompt";
  if (isIos()) return "ios";
  return "manual";
}

/**
 * Install state plus one `install()` that does the right thing per platform:
 * the browser's own dialog where it exists, otherwise opens instructions.
 */
export function useInstallPrompt() {
  const [mode, setMode] = useState<InstallMode>("unknown");
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    listenOnce();
    const update = () => setMode(currentMode());
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  async function install(): Promise<boolean> {
    if (mode === "prompt" && deferredPrompt) {
      const prompt = deferredPrompt;
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      deferredPrompt = null;
      setMode(outcome === "accepted" ? "installed" : currentMode());
      return outcome === "accepted";
    }
    setHelpOpen(true);
    return false;
  }

  return { mode, install, helpOpen, closeHelp: () => setHelpOpen(false) };
}

/** Step-by-step help for platforms without a one-tap install. */
export function InstallHelpModal({ open, onClose, mode }: { open: boolean; onClose: () => void; mode: InstallMode }) {
  const t = useTranslations("pwa");
  const tc = useTranslations("common");
  const ios = mode === "ios";

  const steps = ios
    ? [
        { Icon: Share, text: t("ios.step1"), className: "text-blue-600" },
        { Icon: SquarePlus, text: t("ios.step2") },
        { Icon: Download, text: t("ios.step3") },
      ]
    : [
        { Icon: EllipsisVertical, text: t("manual.step1") },
        { Icon: SquarePlus, text: t("manual.step2") },
        { Icon: Download, text: t("manual.step3") },
      ];

  return (
    <Modal open={open} onClose={onClose} title={ios ? t("ios.title") : t("manual.title")} closeLabel={tc("close")}>
      <ol className="flex flex-col gap-4">
        {steps.map(({ Icon, text, className }) => (
          <li key={text} className="flex items-start gap-3">
            <Icon aria-hidden="true" className={`mt-0.5 h-6 w-6 shrink-0 ${className ?? ""}`} />
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 rounded-lg bg-gray-100 p-3 text-sm text-gray-700">
        {ios ? t("ios.safariOnly") : t("manual.inAppBrowser")}
      </p>
      <Button fullWidth className="mt-4" onClick={onClose}>
        {t("ios.done")}
      </Button>
    </Modal>
  );
}
