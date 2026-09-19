import { cn } from "@/lib/cn";

type Tone = "neutral" | "yellow" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700",
  yellow: "bg-brand-yellow-soft text-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-navy-soft text-white",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
