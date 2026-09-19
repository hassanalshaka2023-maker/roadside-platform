import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
}

/**
 * A native <select> on purpose: it is the lightest control there is, it works
 * without JavaScript, and mobile browsers render it as the OS picker, which
 * is far easier to use on an old phone than any custom dropdown.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { hasError, className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "min-h-touch w-full rounded-lg border-2 bg-white px-3 text-base text-ink",
        "disabled:cursor-not-allowed disabled:bg-gray-100",
        hasError
          ? "border-brand-red focus:border-brand-red"
          : "border-gray-300 focus:border-ink",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
