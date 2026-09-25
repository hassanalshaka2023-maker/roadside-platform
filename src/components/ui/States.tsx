import { AlertTriangle, Inbox } from "lucide-react";

import { cn } from "@/lib/cn";

/** Every list in the app has an empty state; this is it. */
export function EmptyState({
  title,
  text,
  action,
  className,
}: {
  title: string;
  text?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-xl bg-gray-50 p-8 text-center", className)}>
      <Inbox aria-hidden="true" className="h-8 w-8 text-gray-400" />
      <p className="font-extrabold text-gray-700">{title}</p>
      {text ? <p className="max-w-md text-sm text-gray-600">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** A technical failure - never worded as a business answer. */
export function ErrorState({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-xl bg-danger-soft p-8 text-center">
      <AlertTriangle aria-hidden="true" className="h-8 w-8 text-danger" />
      <p className="font-extrabold text-danger">{title}</p>
      {text ? <p className="max-w-md text-sm text-gray-700">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Label/value row used on detail screens. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-gray-100 py-2 last:border-b-0">
      <dt className="text-sm font-bold text-gray-600">{label}</dt>
      <dd className="text-start font-semibold">{children}</dd>
    </div>
  );
}

/** Banner for notices that must not be missed (demo data, suspension...). */
export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children?: React.ReactNode;
}) {
  const tones = {
    info: "border-navy/20 bg-navy/5 text-ink",
    warning: "border-warning/40 bg-warning-soft text-ink",
    danger: "border-danger/40 bg-danger-soft text-ink",
    success: "border-success/40 bg-success-soft text-ink",
  };
  return (
    <div className={cn("rounded-xl border-2 p-4", tones[tone])}>
      {title ? <p className="font-extrabold">{title}</p> : null}
      {children ? <div className={cn("text-sm", title && "mt-1")}>{children}</div> : null}
    </div>
  );
}
