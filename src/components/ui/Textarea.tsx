import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ hasError, className, rows = 4, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          "w-full rounded-lg border-2 bg-white p-3 text-base text-ink",
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
  },
);
