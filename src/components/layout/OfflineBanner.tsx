"use client";

import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOffline } from "next/offline";

/**
 * Tells the user their connection dropped - and that what they pressed will
 * be sent when it returns. Next.js (experimental.useOffline) holds the
 * pending navigation or action and retries it once; our actions are
 * idempotent, so a retry never creates a duplicate.
 */
export function OfflineBanner() {
  const offline = useOffline();
  const t = useTranslations("common");
  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-brand-red px-4 py-2 text-sm font-bold text-white"
    >
      <WifiOff aria-hidden="true" className="h-4 w-4" />
      {t("offline")}
    </div>
  );
}
