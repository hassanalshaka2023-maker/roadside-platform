"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import { Button, type ButtonProps } from "./Button";

/** Mirrors ActionResult from src/lib/action-result.ts (server-only). */
export interface FormActionResult {
  ok: boolean;
  errorKey?: string;
  errorValues?: Record<string, string | number>;
  data?: unknown;
}

const EMPTY: FormActionResult = { ok: false };

/**
 * A form wired to a server action, with the three states every mutation in
 * the app needs: pending (inputs disabled, button spinning), error (the
 * translated reason, announced to screen readers) and success.
 *
 * Server pages compose these with hidden inputs, so most screens need no
 * bespoke client code at all. Works without JavaScript too: the form still
 * posts, the page re-renders.
 */
/**
 * Any server action returning an ActionResult. The previous-state parameter
 * is typed `never` so actions with a more specific result type fit.
 */
type AnyFormAction = (prev: never, formData: FormData) => Promise<FormActionResult>;
type StateAction = (prev: FormActionResult, formData: FormData) => Promise<FormActionResult>;

export function ActionForm({
  action,
  children,
  successMessage,
  className,
  resetOnSuccess = false,
  onSuccess,
}: {
  action: AnyFormAction;
  children: React.ReactNode;
  /** Translation key shown after a successful submit. */
  successMessage?: string;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (result: FormActionResult) => void;
}) {
  const t = useTranslations();
  const [state, formAction] = useActionState(action as unknown as StateAction, EMPTY);
  const formRef = useRef<HTMLFormElement>(null);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    if (!state.ok) return;
    if (resetOnSuccess) formRef.current?.reset();
    onSuccessRef.current?.(state);
  }, [state, resetOnSuccess]);

  return (
    <form ref={formRef} action={formAction} className={cn("flex flex-col gap-4", className)}>
      {children}

      {state.errorKey ? (
        <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm font-semibold text-danger">
          {t(state.errorKey, state.errorValues)}
        </p>
      ) : null}

      {state.ok && successMessage ? (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-success-soft p-3 text-sm font-semibold text-success">
          <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
          {t(successMessage)}
        </p>
      ) : null}
    </form>
  );
}

/** Submit button that knows when its form is pending. */
export function SubmitButton({ children, ...props }: Omit<ButtonProps, "type" | "isLoading">) {
  const { pending } = useFormStatus();
  const t = useTranslations("common");
  return (
    <Button type="submit" isLoading={pending} loadingLabel={t("sending")} {...props}>
      {children}
    </Button>
  );
}
