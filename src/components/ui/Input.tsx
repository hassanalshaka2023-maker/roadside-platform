import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

/**
 * Base text input. 16px font size on purpose: anything smaller makes iOS
 * Safari zoom in on focus, which on a narrow screen looks like a bug.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { hasError, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "min-h-touch w-full rounded-lg border-2 bg-white px-3 text-base text-ink",
        "placeholder:text-gray-400",
        "disabled:cursor-not-allowed disabled:bg-gray-100",
        hasError
          ? "border-brand-red focus:border-brand-red"
          : "border-gray-300 focus:border-ink",
        className,
      )}
      {...props}
    />
  );
});
