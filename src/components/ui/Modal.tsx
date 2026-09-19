"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Translated title; also used as the dialog's accessible name. */
  title: string;
  /** Translated label for the close button. */
  closeLabel: string;
  children: React.ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog.
 *
 * Hand-written rather than pulled from Radix or similar: the whole thing is
 * about a hundred lines, and the project's constraint is a small bundle on
 * weak connections. It does the four things that actually matter - trap
 * focus, close on Escape, restore focus on close, and lock background scroll.
 *
 * The native <dialog> element would be simpler, but it is unsupported on the
 * older Android browsers this app has to work on.
 */
export function Modal({
  open,
  onClose,
  title,
  closeLabel,
  children,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Wrap around, so Tab can never reach the page behind the dialog.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    // Move focus into the dialog so the next Tab stays inside it.
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink/60"
        // Decorative: Escape and the close button are the real affordances.
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-card",
          "sm:max-w-lg sm:rounded-2xl",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="min-h-touch min-w-touch rounded-lg px-2 text-2xl leading-none text-gray-500 hover:bg-gray-100"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
