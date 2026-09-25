import { useTranslations } from "next-intl";

import { toLocalFormat } from "@/lib/phone";

/**
 * The number to call someone on: their verified phone, or - for accounts that
 * signed in by email - the contact number they typed, marked as unverified.
 */
export function contactNumberOf(user: { phone: string | null; contactPhone?: string | null }) {
  if (user.phone) return { number: user.phone, verified: true };
  if (user.contactPhone) return { number: user.contactPhone, verified: false };
  return null;
}

export function ContactNumber({
  user,
  fallback = "—",
}: {
  user: { phone: string | null; contactPhone?: string | null; email?: string | null };
  fallback?: string;
}) {
  const t = useTranslations("auth");
  const contact = contactNumberOf(user);
  if (!contact) return <>{user.email ? <bdi dir="ltr">{user.email}</bdi> : fallback}</>;
  return (
    <>
      <bdi dir="ltr" className="numeric">
        {toLocalFormat(contact.number)}
      </bdi>
      {!contact.verified ? <span className="ms-1 text-xs font-normal text-warning">({t("unverified")})</span> : null}
    </>
  );
}
