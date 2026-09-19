import { forwardRef } from "react";

import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

/**
 * Brand rule: text on yellow is always ink, never white.
 * Red is reserved for urgency and destructive actions, and used sparingly.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-yellow text-ink hover:bg-brand-yellow-hover active:bg-brand-yellow-hover",
  secondary: "bg-ink text-white hover:bg-navy active:bg-navy",
  danger: "bg-brand-red text-white hover:bg-brand-red-dark",
  outline: "border-2 border-ink bg-transparent text-ink hover:bg-gray-100",
  ghost: "bg-transparent text-ink hover:bg-gray-100",
};

/**
 * Every size keeps a 44px minimum height: the accessible touch target, and a
 * practical one for someone tapping with cold hands at the roadside.
 */
const SIZES: Record<Size, string> = {
  sm: "min-h-touch px-3 text-sm",
  md: "min-h-touch px-5 text-base",
  lg: "min-h-[52px] px-6 text-lg",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  /** Announced while loading, e.g. "Sending…". */
  loadingLabel?: string;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    isLoading = false,
    loadingLabel,
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // Disabled while loading so a double tap on a slow connection cannot
      // submit the same request twice.
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-bold transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {isLoading ? <Spinner className="text-current" /> : null}
      <span>{isLoading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
});
