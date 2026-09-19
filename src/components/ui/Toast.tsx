"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONES: Record<ToastTone, string> = {
  success: "bg-success text-white",
  error: "bg-brand-red text-white",
  info: "bg-ink text-white",
};

let nextId = 0;

/**
 * Minimal toast system.
 *
 * The live region is polite for info and success and assertive for errors, so
 * a failed action interrupts a screen reader while a confirmation waits its
 * turn.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId++;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5000);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // Bottom-centred on mobile: within thumb reach and clear of the
        // floating WhatsApp button on the start side.
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            aria-live={toast.tone === "error" ? "assertive" : "polite"}
            className={cn(
              "pointer-events-auto w-full max-w-sm rounded-lg px-4 py-3 text-sm font-semibold shadow-card",
              TONES[toast.tone],
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a <ToastProvider>");
  }
  return context;
}
