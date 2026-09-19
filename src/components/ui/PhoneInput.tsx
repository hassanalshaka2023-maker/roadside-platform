"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/cn";
import { toAsciiDigits } from "@/lib/phone";

export interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  hasError?: boolean;
}

/**
 * Phone entry for Syrian numbers.
 *
 * The user types the number the way it is written locally (09XXXXXXXX); the
 * +963 prefix is shown as a fixed, non-editable adornment so nobody has to
 * think about country codes. Normalization to E.164 happens on the server,
 * in normalizeSyrianPhone().
 *
 * `dir="ltr"` on the input is deliberate even on the Arabic page: phone
 * numbers read left-to-right, and letting them inherit RTL puts the cursor
 * and the digits in confusing places.
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ value, onChange, hasError, className, ...props }, ref) {
    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      // Arabic keyboards produce ٠١٢…; convert before anything else sees it.
      const digits = toAsciiDigits(event.target.value).replace(/\D/g, "");
      // 10 digits covers the local 09XXXXXXXX form.
      onChange(digits.slice(0, 10));
    }

    return (
      <div
        className={cn(
          "flex min-h-touch w-full items-stretch overflow-hidden rounded-lg border-2 bg-white",
          hasError ? "border-brand-red" : "border-gray-300 focus-within:border-ink",
          className,
        )}
      >
        <span
          // Decorative: screen readers get the country from the hint text on
          // the field, and reading "+963" as part of the value is confusing.
          aria-hidden="true"
          className="flex select-none items-center border-e-2 border-gray-200 bg-gray-50 px-3 text-base font-bold text-gray-600"
          dir="ltr"
        >
          +963
        </span>
        <input
          ref={ref}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          dir="ltr"
          value={value}
          onChange={handleChange}
          className="numeric min-w-0 flex-1 bg-transparent px-3 text-base text-ink placeholder:text-gray-400 focus:outline-none"
          {...props}
        />
      </div>
    );
  },
);
