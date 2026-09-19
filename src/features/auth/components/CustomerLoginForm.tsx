"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { fieldAria, FormField } from "@/components/ui/FormField";
import { OtpInput } from "@/components/ui/OtpInput";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { maskPhone } from "@/lib/phone";
import { requestOtpAction, verifyOtpAction, type ActionState } from "../actions";

const EMPTY: ActionState = { ok: false };

/**
 * Two-step phone login.
 *
 * Step 1 asks for the number, step 2 for the code. The phone is carried
 * forward in a hidden field rather than re-entered, and the resend button
 * stays hidden for the cooldown the server reported, so the user is never
 * invited to press a button that will be refused.
 */
export function CustomerLoginForm() {
  const t = useTranslations();
  const locale = useLocale();

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  const [requestState, submitRequest, requestPending] = useActionState(
    requestOtpAction,
    EMPTY,
  );
  const [verifyState, submitVerify, verifyPending] = useActionState(
    verifyOtpAction,
    EMPTY,
  );

  /**
   * Counts how many times the server has answered, so each new code restarts
   * the countdown via a fresh `key`. This is React's documented "adjust state
   * during render" pattern; an effect here would cascade renders.
   */
  const [seenState, setSeenState] = useState(requestState);
  const [attempt, setAttempt] = useState(0);

  if (requestState !== seenState) {
    setSeenState(requestState);
    setAttempt((value) => value + 1);
  }

  // Once a code has been sent we move to step 2 and stay there, even if a
  // later verify attempt fails.
  const sentTo = requestState.ok ? requestState.phone : undefined;

  /** Resolves "namespace.KEY" from the server into a translated sentence. */
  function message(state: ActionState): string | undefined {
    if (!state.errorKey) return undefined;
    return t(state.errorKey, state.errorValues);
  }

  if (!sentTo) {
    return (
      <form action={submitRequest} className="flex flex-col gap-5">
        <input type="hidden" name="locale" value={locale} />

        <FormField
          htmlFor="phone"
          label={t("auth.phoneLabel")}
          hint={t("auth.phoneHint")}
          error={message(requestState)}
          required
        >
          <PhoneInput
            id="phone"
            name="phone"
            value={phone}
            onChange={setPhone}
            placeholder={t("auth.phonePlaceholder")}
            hasError={Boolean(requestState.errorKey)}
            {...fieldAria("phone", {
              hint: t("auth.phoneHint"),
              error: message(requestState),
            })}
          />
        </FormField>

        <Button
          type="submit"
          size="lg"
          fullWidth
          isLoading={requestPending}
          loadingLabel={t("common.loading")}
        >
          {t("auth.sendCode")}
        </Button>
      </form>
    );
  }

  const resendButton = (
    // formAction rather than a nested <form>: nesting forms is invalid HTML
    // and browsers silently drop the inner one.
    <Button
      type="submit"
      formAction={submitRequest}
      variant="ghost"
      size="sm"
      disabled={requestPending}
    >
      {t("auth.resend")}
    </Button>
  );

  return (
    <form action={submitVerify} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="phone" value={sentTo} />

      <p className="text-center text-sm text-gray-600">
        {t("auth.otpSubtitle", { phone: maskPhone(sentTo) })}
      </p>

      <FormField
        htmlFor="otp"
        label={t("auth.otpLabel")}
        error={message(verifyState)}
        className="items-center"
        required
      >
        <input type="hidden" name="code" value={code} />
        <OtpInput
          id="otp"
          value={code}
          onChange={setCode}
          label={t("auth.otpLabel")}
          hasError={Boolean(verifyState.errorKey)}
          disabled={verifyPending}
          autoFocus
        />
      </FormField>

      <Button
        type="submit"
        size="lg"
        fullWidth
        isLoading={verifyPending}
        loadingLabel={t("common.loading")}
        disabled={code.length < 6}
      >
        {t("auth.verify")}
      </Button>

      <div className="flex flex-col items-center gap-2">
        <Countdown
          key={attempt}
          seconds={requestState.resendAfterSeconds ?? 0}
          whenDone={resendButton}
        >
          {(remaining) => (
            <p className="text-sm text-gray-500">
              {t("auth.resendIn", { seconds: remaining })}
            </p>
          )}
        </Countdown>
      </div>
    </form>
  );
}
