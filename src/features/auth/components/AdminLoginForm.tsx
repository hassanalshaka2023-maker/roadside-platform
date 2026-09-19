"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { fieldAria, FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { adminLoginAction, type ActionState } from "../actions";

const EMPTY: ActionState = { ok: false };

export function AdminLoginForm() {
  const t = useTranslations();
  const locale = useLocale();
  const [state, submit, pending] = useActionState(adminLoginAction, EMPTY);

  // One generic error for the whole form, never per-field: telling the user
  // which of the two was wrong is exactly the enumeration we must avoid.
  const error = state.errorKey ? t(state.errorKey, state.errorValues) : undefined;

  return (
    <form action={submit} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-4 py-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      ) : null}

      <FormField htmlFor="email" label={t("auth.emailLabel")} required>
        <Input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="username"
          required
          hasError={Boolean(error)}
          {...fieldAria("email", {})}
        />
      </FormField>

      <FormField htmlFor="password" label={t("auth.passwordLabel")} required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          hasError={Boolean(error)}
          {...fieldAria("password", {})}
        />
      </FormField>

      <Button
        type="submit"
        size="lg"
        fullWidth
        isLoading={pending}
        loadingLabel={t("common.loading")}
      >
        {t("auth.signIn")}
      </Button>
    </form>
  );
}
