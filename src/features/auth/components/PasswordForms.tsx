"use client";

import { Eye, EyeOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { fieldAria, FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { OtpInput } from "@/components/ui/OtpInput";
import { Link } from "@/i18n/navigation";
import { PASSWORD_MIN } from "@/lib/auth/identifier";
import { maskEmail } from "@/lib/email-address";
import { maskPhone } from "@/lib/phone";
import {
  completePasswordResetAction,
  passwordLoginAction,
  requestPasswordResetAction,
  setPasswordAction,
  type ActionState,
} from "../actions";

const EMPTY: ActionState = { ok: false };

function ErrorBox({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
      {message}
    </p>
  );
}

/** A password box with a show/hide toggle: typing blind on a phone is error-prone. */
function PasswordInput({
  id,
  name,
  autoComplete,
  hasError,
  hint,
}: {
  id: string;
  name: string;
  autoComplete: "current-password" | "new-password";
  hasError?: boolean;
  hint?: string;
}) {
  const t = useTranslations("passwordAuth");
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        dir="ltr"
        autoComplete={autoComplete}
        required
        minLength={autoComplete === "new-password" ? PASSWORD_MIN : undefined}
        maxLength={200}
        hasError={hasError}
        className="pe-12"
        {...fieldAria(id, { hint })}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("hide") : t("show")}
        aria-pressed={visible}
        className="absolute inset-y-0 end-0 flex min-w-touch items-center justify-center text-gray-500 hover:text-ink"
      >
        {visible ? <EyeOff aria-hidden="true" className="h-5 w-5" /> : <Eye aria-hidden="true" className="h-5 w-5" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PasswordLoginForm({ next }: { next?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, submit, pending] = useActionState(passwordLoginAction, EMPTY);
  // One message for the whole form: never say which of the two was wrong.
  const error = state.errorKey ? t(state.errorKey, state.errorValues) : undefined;

  return (
    <form action={submit} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <ErrorBox message={error} />

      <FormField htmlFor="identifier" label={t("passwordAuth.identifierLabel")} hint={t("passwordAuth.identifierHint")} required>
        <Input
          id="identifier"
          name="identifier"
          type="text"
          dir="ltr"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={320}
          placeholder={t("passwordAuth.identifierPlaceholder")}
          hasError={Boolean(error)}
          {...fieldAria("identifier", { hint: t("passwordAuth.identifierHint") })}
        />
      </FormField>

      <FormField htmlFor="password" label={t("auth.passwordLabel")} required>
        <PasswordInput id="password" name="password" autoComplete="current-password" hasError={Boolean(error)} />
      </FormField>

      <div className="-mt-2 flex justify-end">
        <Link href="/forgot-password" className="text-sm font-bold text-ink underline underline-offset-4">
          {t("passwordAuth.forgot")}
        </Link>
      </div>

      <Button type="submit" size="lg" fullWidth isLoading={pending} loadingLabel={t("common.loading")}>
        {t("auth.signIn")}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------

/** New password + confirmation, shared by "set" and "reset". */
function NewPasswordFields({ hasError }: { hasError: boolean }) {
  const t = useTranslations("passwordAuth");
  return (
    <>
      <FormField htmlFor="password" label={t("newPassword")} hint={t("newPasswordHint", { min: PASSWORD_MIN })} required>
        <PasswordInput id="password" name="password" autoComplete="new-password" hasError={hasError} hint={t("newPasswordHint", { min: PASSWORD_MIN })} />
      </FormField>
      <FormField htmlFor="confirm" label={t("confirmPassword")} required>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" hasError={hasError} />
      </FormField>
    </>
  );
}

export function ForgotPasswordForm({ channels }: { channels: { phone: boolean; email: boolean } }) {
  const t = useTranslations();
  const locale = useLocale();
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [sendState, send, sending] = useActionState(requestPasswordResetAction, EMPTY);
  const [resetState, reset, resetting] = useActionState(completePasswordResetAction, EMPTY);

  // A fresh countdown for every code sent ("adjust state during render").
  const [seen, setSeen] = useState(sendState);
  const [attempt, setAttempt] = useState(0);
  if (sendState !== seen) {
    setSeen(sendState);
    setAttempt((n) => n + 1);
  }

  const sentTo = sendState.ok ? sendState.destination : undefined;
  const hint = t(channels.phone ? "passwordAuth.identifierHint" : "passwordAuth.emailOnlyHint");

  if (!sentTo) {
    const error = sendState.errorKey ? t(sendState.errorKey, sendState.errorValues) : undefined;
    return (
      <form action={send} className="flex flex-col gap-5">
        <input type="hidden" name="locale" value={locale} />
        <FormField htmlFor="identifier" label={t("passwordAuth.identifierLabel")} hint={hint} error={error} required>
          <Input
            id="identifier"
            name="identifier"
            type="text"
            dir="ltr"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={320}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={t("passwordAuth.identifierPlaceholder")}
            hasError={Boolean(error)}
            {...fieldAria("identifier", { hint, error })}
          />
        </FormField>
        <Button type="submit" size="lg" fullWidth isLoading={sending} loadingLabel={t("common.sending")}>
          {t("auth.sendCode")}
        </Button>
      </form>
    );
  }

  const error = resetState.errorKey ? t(resetState.errorKey, resetState.errorValues) : undefined;
  const isEmail = sendState.channel === "email";
  return (
    <form action={reset} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="destination" value={sentTo} />
      <input type="hidden" name="identifier" value={sentTo} />
      <input type="hidden" name="code" value={code} />

      {/* Deliberately "if an account exists": the server never says whether it does. */}
      <p className="text-center text-sm text-gray-600">
        {t(isEmail ? "passwordAuth.codeSentEmail" : "passwordAuth.codeSentPhone", {
          to: isEmail ? maskEmail(sentTo) : maskPhone(sentTo),
        })}
      </p>
      <ErrorBox message={error} />

      <FormField htmlFor="otp" label={t("auth.otpLabel")} className="items-center" required>
        <OtpInput id="otp" value={code} onChange={setCode} label={t("auth.otpLabel")} hasError={Boolean(error)} disabled={resetting} autoFocus />
      </FormField>

      <NewPasswordFields hasError={Boolean(error)} />

      <Button type="submit" size="lg" fullWidth isLoading={resetting} loadingLabel={t("common.saving")} disabled={code.length < 6}>
        {t("passwordAuth.saveAndSignIn")}
      </Button>

      <div className="flex flex-col items-center gap-2">
        <Countdown
          key={attempt}
          seconds={sendState.resendAfterSeconds ?? 0}
          whenDone={
            <Button type="submit" formAction={send} variant="ghost" size="sm" disabled={sending}>
              {t("auth.resend")}
            </Button>
          }
        >
          {(remaining) => <p className="text-sm text-gray-500">{t("auth.resendIn", { seconds: remaining })}</p>}
        </Countdown>
        {isEmail ? <p className="text-xs text-gray-500">{t("auth.checkSpam")}</p> : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

export function SetPasswordForm({ hasPassword, next }: { hasPassword: boolean; next?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, submit, pending] = useActionState(setPasswordAction, EMPTY);
  const error = state.errorKey ? t(state.errorKey, state.errorValues) : undefined;

  return (
    <form action={submit} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <ErrorBox message={error} />

      {hasPassword ? (
        <FormField htmlFor="currentPassword" label={t("passwordAuth.currentPassword")} required>
          <PasswordInput id="currentPassword" name="currentPassword" autoComplete="current-password" hasError={Boolean(error)} />
        </FormField>
      ) : null}

      <NewPasswordFields hasError={Boolean(error)} />

      <Button type="submit" size="lg" fullWidth isLoading={pending} loadingLabel={t("common.saving")}>
        {t("passwordAuth.save")}
      </Button>
    </form>
  );
}
