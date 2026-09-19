import { cn } from "@/lib/cn";

export interface FormFieldProps {
  /** Must match the id of the control inside, so the label is clickable. */
  htmlFor: string;
  label: string;
  /** Rendered and linked via aria-describedby. */
  hint?: string;
  /** Rendered and linked via aria-errormessage; also flips the control to red. */
  error?: string;
  required?: boolean;
  optionalLabel?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Wraps a control with its label, hint and error, and wires up the aria
 * relationships so screen readers announce all three together.
 *
 * Use `fieldIds()` to build matching ids for the control.
 */
export function FormField({
  htmlFor,
  label,
  hint,
  error,
  required,
  optionalLabel,
  className,
  children,
}: FormFieldProps) {
  const ids = fieldIds(htmlFor);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-bold text-ink">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-1 text-brand-red">
            *
          </span>
        ) : optionalLabel ? (
          <span className="ms-2 font-normal text-gray-500">({optionalLabel})</span>
        ) : null}
      </label>

      {children}

      {hint && !error ? (
        <p id={ids.hint} className="text-sm text-gray-600">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p
          id={ids.error}
          // assertive: a validation error after submit must interrupt, not
          // wait for the user to finish whatever they are doing.
          role="alert"
          className="text-sm font-semibold text-brand-red"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The ids FormField expects, so controls can reference them. */
export function fieldIds(id: string) {
  return { hint: `${id}-hint`, error: `${id}-error` };
}

/** aria-* props a control should spread when used inside a FormField. */
export function fieldAria(id: string, { hint, error }: { hint?: string; error?: string }) {
  const ids = fieldIds(id);
  const describedBy = [hint && !error ? ids.hint : null, error ? ids.error : null]
    .filter(Boolean)
    .join(" ");

  return {
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": describedBy || undefined,
  };
}
