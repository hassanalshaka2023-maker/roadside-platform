"use client";

import { useEffect, useRef } from "react";

import { usePathname } from "@/i18n/navigation";

/**
 * A <details> menu that closes itself after navigation. Without JavaScript it
 * is still a working toggle; the script only adds the auto-close, which the
 * header needs because it stays mounted between pages.
 */
export function MobileMenu({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current) ref.current.open = false;
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <details ref={ref} className={className}>
      {children}
    </details>
  );
}
