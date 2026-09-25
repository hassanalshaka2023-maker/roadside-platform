"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Mail, Smartphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { fieldAria, FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { OtpInput } from "@/components/ui/OtpInput";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { cn } from "@/lib/cn";
import { maskEmail } from "@/lib/email-address";
import { maskPhone } from "@/lib/phone";

/** Mirrors CodeFlowState in src/lib/auth/code-sign-in.ts (server-only). */
export interface CodeFlowFormState {
  ok: boolean;
  errorKey?: string;
  errorValues?: Record<string, string | number>;
  channel?: "phone" | "email";
  destination?: string;
  resendAfterSeconds?: number;
  /** Request form only: whether an ID must be attached. */
  idRequired?: boolean;
}

/** Previous state typed `never` so actions with richer state types fit. */
type FlowAction = (prev: never, formData: FormData) => Promise<CodeFlowFormState>;
type StateAction = (prev: CodeFlowFormState, formData: FormData) => Promise<CodeFlowFormState>;

/**
 * Two steps: where to send the code (phone or email), then the code.
 *
 * Email exists because no SMS gateway is connected yet. With email, a contact
 * phone can be asked for (the request form needs one so the provider can
 * call); it is stored as unverified.
 */
export function CodeSignInForm({
  channels,
  sendAction,
  verifyAction,
  hidden = {},
  askContactPhone = false,
  onVerified,
  verifyLabel,
}: {
  channels: { phone: boolean; email: boolean };
  sendAction: FlowAction;
  verifyAction: FlowAction;
  hidden?: Record<string, string>;
  askContactPhone?: boolean;
  onVerified?: (state: CodeFlowFormState) => void;
  verifyLabel?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();

  const [channel, setChannel] = useState<"phone" | "email">(channels.phone ? "phone" : "email");
  const [value, setValue] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [code, setCode] = useState("");

  const [sendState, send, sending] = useActionState(sendAction as unknown as StateAction, { ok: false });
  const [verifyState, verify, verifying] = useActionState(verifyAction as unknown as StateAction, { ok: false });

  // A fresh countdown for every code sent ("adjust state during render").
  const [seen, setSeen] = useState(sendState);
  const [attempt, setAttempt] = useState(0);
  if (sendState !== seen) {
    setSeen(sendState);
    setAttempt((n) => n + 1);
  }

  const onVerifiedRef = useRef(onVerified);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
  }, [onVerified]);
  useEffect(() => {
    if (verifyState.ok) onVerifiedRef.current?.(verifyState);
  }, [verifyState]);

  const message = (state: CodeFlowFormState) => (state.errorKey ? t(state.errorKey, state.errorValues) : undefined);
  const hiddenInputs = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="channel" value={channel} />
      {Object.entries(hidden).map(([name, v]) => (
        <input key={name} type="hidden" name={name} value={v} />
      ))}
    </>
  );

  const sentTo = sendState.ok && sendState.channel === channel ? sendState.destination : undefined;

  if (!channels.phone && !channels.email) {
    return <p className="rounded-lg bg-danger-soft p-3 text-danger">{t("auth.noChannel")}</p>;
  }

  if (!sentTo) {
    const error = message(sendState);
    return (
      <form action={send} className="flex flex-col gap-5">
        {hiddenInputs}

        {channels.phone && channels.email ? (
          <div role="tablist" aria-label={t("auth.channelLabel")} className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
            {(["phone", "email"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={channel === c}
                onClick={() => setChannel(c)}
                className={cn(
                  "inline-flex min-h-touch items-center justify-center gap-2 rounded-lg text-sm font-bold",
                  channel === c ? "bg-white text-ink shadow-card" : "text-gray-600",
                )}
              >
                {c === "phone" ? <Smartphone aria-hidden="true" className="h-4 w-4" /> : <Mail aria-hidden="true" className="h-4 w-4" />}
                {t(c === "phone" ? "auth.byPhone" : "auth.byEmail")}
              </button>
            ))}
          </div>
        ) : null}

        {channel === "phone" ? (
          <FormField htmlFor="destination" label={t("auth.phoneLabel")} hint={t("auth.phoneHint")} error={error} required>
            <PhoneInput
              id="destination"
              name="destination"
              value={value}
              onChange={setValue}
              placeholder={t("auth.phonePlaceholder")}
              hasError={Boolean(error)}
              {...fieldAria("destination", { hint: t("auth.phoneHint"), error })}
            />
          </FormField>
        ) : (
          <FormField htmlFor="destination" label={t("auth.emailLabel")} hint={t("auth.emailHint")} error={error} required>
            <Input
              id="destination"
              name="destination"
              type="email"
              dir="ltr"
              autoComplete="email"
              inputMode="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="name@example.com"
              hasError={Boolean(error)}
              {...fieldAria("destination", { hint: t("auth.emailHint"), error })}
            />
          </FormField>
        )}

        <Button type="submit" size="lg" fullWidth isLoading={sending} loadingLabel={t("common.sending")}>
          {t("auth.sendCode")}
        </Button>
      </form>
    );
  }

  const verifyError = message(verifyState);
  return (
    <form action={verify} className="flex flex-col gap-5">
      {hiddenInputs}
      <input type="hidden" name="destination" value={sentTo} />
      <input type="hidden" name="code" value={code} />

      <p className="text-center text-sm text-gray-600">
        {channel === "email"
          ? t("auth.otpSubtitleEmail", { email: maskEmail(sentTo) })
          : t("auth.otpSubtitle", { phone: maskPhone(sentTo) })}
      </p>

      <FormField htmlFor="otp" label={t("auth.otpLabel")} error={channel === "email" && askContactPhone ? undefined : verifyError} className="items-center" required>
        <OtpInput id="otp" value={code} onChange={setCode} label={t("auth.otpLabel")} hasError={Boolean(verifyError)} disabled={verifying} autoFocus />
      </FormField>

      {channel === "email" && askContactPhone ? (
        <FormField htmlFor="contactPhone" label={t("auth.contactPhoneLabel")} hint={t("auth.contactPhoneHint")} error={verifyError} required>
          <PhoneInput id="contactPhone" name="contactPhone" value={contactPhone} onChange={setContactPhone} placeholder={t("auth.phonePlaceholder")} hasError={Boolean(verifyError)} />
        </FormField>
      ) : null}

      <Button type="submit" size="lg" fullWidth isLoading={verifying} loadingLabel={t("common.loading")} disabled={code.length < 6}>
        {verifyLabel ?? t("auth.verify")}
      </Button>

      <div className="flex flex-col items-center gap-2">
        <Countdown
          key={attempt}
          seconds={sendState.resendAfterSeconds ?? 0}
          whenDone={
            // Resend goes through the send action with the same destination.
            <Button type="submit" formAction={send} variant="ghost" size="sm" disabled={sending}>
              {t("auth.resend")}
            </Button>
          }
        >
          {(remaining) => <p className="text-sm text-gray-500">{t("auth.resendIn", { seconds: remaining })}</p>}
        </Countdown>
        {channel === "email" ? <p className="text-xs text-gray-500">{t("auth.checkSpam")}</p> : null}
      </div>
    </form>
  );
}
