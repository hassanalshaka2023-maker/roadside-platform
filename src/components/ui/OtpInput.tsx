"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";
import { toAsciiDigits } from "@/lib/phone";

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the last box is filled, so the form can submit itself. */
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  hasError?: boolean;
  /** Translated label for the group, e.g. "رمز التحقّق". */
  label: string;
  /** Translated per-box label template receiving the 1-based index. */
  boxLabel?: (index: number) => string;
  id?: string;
  autoFocus?: boolean;
}

/**
 * Six separate boxes for the OTP.
 *
 * RTL notes: the wrapper is forced to `dir="ltr"` so digit 1 is on the left
 * and the fill order matches what the SMS shows, even though the surrounding
 * page is right-to-left. Arabic-Indic digits typed on an Arabic keyboard are
 * converted on the way in.
 *
 * Pasting the whole code into any box distributes it across all of them,
 * which is what people do when they copy the code out of the SMS app.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  hasError,
  label,
  boxLabel,
  id = "otp",
  autoFocus,
}: OtpInputProps) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  function setDigits(next: string) {
    const clean = toAsciiDigits(next).replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  }

  function handleChange(index: number, raw: string) {
    const digits = toAsciiDigits(raw).replace(/\D/g, "");
    if (digits.length === 0) return;

    // More than one digit means a paste (or a fast autofill): spread it.
    if (digits.length > 1) {
      const filled = setDigits(value.slice(0, index) + digits);
      const focusAt = Math.min(filled.length, length - 1);
      inputs.current[focusAt]?.focus();
      return;
    }

    const chars = value.padEnd(length, " ").split("");
    chars[index] = digits;
    const next = chars.join("").trimEnd();
    setDigits(next);

    if (index < length - 1) inputs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault();
      const chars = value.padEnd(length, " ").split("");

      if (chars[index] && chars[index] !== " ") {
        // Clear this box and stay put.
        chars[index] = " ";
        setDigits(chars.join("").replace(/\s+$/, ""));
      } else if (index > 0) {
        // Already empty: step back and clear the previous one.
        chars[index - 1] = " ";
        setDigits(chars.join("").replace(/\s+$/, ""));
        inputs.current[index - 1]?.focus();
      }
      return;
    }

    // Arrow keys move between boxes. In an LTR group, Left is always previous.
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < length - 1) {
      event.preventDefault();
      inputs.current[index + 1]?.focus();
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const filled = setDigits(event.clipboardData.getData("text"));
    inputs.current[Math.min(filled.length, length - 1)]?.focus();
  }

  return (
    <div
      role="group"
      aria-label={label}
      dir="ltr"
      className="flex justify-center gap-2"
    >
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(element) => {
            inputs.current[index] = element;
          }}
          id={index === 0 ? id : `${id}-${index}`}
          type="text"
          inputMode="numeric"
          // Lets the browser/OS offer the code straight from the SMS.
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={length}
          disabled={disabled}
          aria-label={boxLabel ? boxLabel(index + 1) : `${label} ${index + 1}`}
          aria-invalid={hasError || undefined}
          value={value[index] ?? ""}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          className={cn(
            "numeric h-14 w-11 rounded-lg border-2 text-center text-2xl font-extrabold text-ink",
            "disabled:cursor-not-allowed disabled:bg-gray-100",
            hasError
              ? "border-brand-red focus:border-brand-red"
              : "border-gray-300 focus:border-ink",
          )}
        />
      ))}
    </div>
  );
}
