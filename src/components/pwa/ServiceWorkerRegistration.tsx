"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which makes the site installable and shows an
 * offline page when the network is gone.
 *
 * Production only: in development a service worker serving cached build
 * assets fights with hot reload and makes changes look like they did not
 * apply.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not fatal: the site works exactly as before, just not installable.
    });
  }, []);

  return null;
}
