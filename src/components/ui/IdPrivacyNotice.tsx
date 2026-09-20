"use client";

import { Eye, Lock, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";

export interface IdPrivacyNoticeProps {
  /** Current consent state, owned by the parent form. */
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  /** Set after a failed submit, to explain why it did not go through. */
  showRequiredError?: boolean;
  disabled?: boolean;
  id?: string;
}

/**
 * Explains, before anyone photographs their national ID, why we are asking,
 * who can see it, how it is stored and when it is destroyed - then takes an
 * explicit consent.
 *
 * This is not decoration. Asking a person for their identity document creates
 * an obligation, and a checkbox with no explanation above it is not consent in
 * any meaningful sense. The consent timestamp is recorded alongside the
 * application (ProviderApplication.consentAcceptedAt).
 */
export function IdPrivacyNotice({
  accepted,
  onAcceptedChange,
  showRequiredError,
  disabled,
  id = "id-privacy-consent",
}: IdPrivacyNoticeProps) {
  const t = useTranslations("idPrivacy");

  const points = [
    { icon: ShieldCheck, title: t("title"), body: t("why") },
    { icon: Eye, title: t("whoTitle"), body: t("who") },
    { icon: Lock, title: t("storageTitle"), body: t("storage") },
    { icon: Trash2, title: t("retentionTitle"), body: t("retention") },
  ];

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-xl border-2 border-gray-200 bg-gray-50 p-4"
    >
      <h3 id={`${id}-heading`} className="text-base font-extrabold">
        {t("title")}
      </h3>

      <ul className="mt-3 flex flex-col gap-3">
        {points.map((point) => (
          <li key={point.title} className="flex gap-3">
            <point.icon
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0 text-brand-red"
            />
            <span className="text-sm">
              <span className="block font-bold">{point.title}</span>
              <span className="mt-0.5 block text-gray-600">{point.body}</span>
            </span>
          </li>
        ))}
      </ul>

      <label
        htmlFor={id}
        className={cn(
          "mt-4 flex min-h-touch cursor-pointer items-start gap-3 rounded-lg p-2",
          "hover:bg-white",
          showRequiredError && !accepted && "bg-danger-soft",
        )}
      >
        <input
          id={id}
          type="checkbox"
          checked={accepted}
          onChange={(event) => onAcceptedChange(event.target.checked)}
          disabled={disabled}
          aria-describedby={showRequiredError && !accepted ? `${id}-error` : undefined}
          // 20px rather than the browser default: a checkbox this important
          // should not be a 13px target on a phone.
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-yellow"
        />
        <span className="text-sm font-semibold">{t("consent")}</span>
      </label>

      {showRequiredError && !accepted ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-bold text-brand-red">
          {t("consentRequired")}
        </p>
      ) : null}
    </section>
  );
}
