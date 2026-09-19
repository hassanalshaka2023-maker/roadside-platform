"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";

/**
 * Generic error boundary for the locale segment.
 *
 * Deliberately shows nothing about the underlying error: stack traces and
 * database messages are for the server logs, not for the customer's screen.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    // The digest is the only safe handle to correlate with the server log.
    console.error("Unhandled error", error.digest);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl">{t("errors.genericTitle")}</h1>
      <p className="max-w-md text-gray-600">{t("errors.genericText")}</p>
      <Button onClick={reset}>{t("common.retry")}</Button>
    </div>
  );
}
