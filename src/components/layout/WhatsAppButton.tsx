import { MessageCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getBusinessPhones, isWhatsappEnabled } from "@/features/settings/queries";
import { normalizeSyrianPhone } from "@/lib/phone";

/**
 * Floating WhatsApp button for the public pages.
 *
 * The numbers come from Settings, not from code, so the office can change
 * them without a deploy. If none are configured the button simply does not
 * render - better than a dead link.
 *
 * WhatsApp expects the number without a leading "+".
 */
export async function WhatsAppButton() {
  const [phones, enabled, t] = await Promise.all([
    getBusinessPhones(),
    isWhatsappEnabled(),
    getTranslations("common"),
  ]);
  if (!enabled) return null;

  const first = phones.find((phone) => normalizeSyrianPhone(phone).ok);
  if (!first) return null;

  const normalized = normalizeSyrianPhone(first);
  if (!normalized.ok) return null;

  const waNumber = normalized.phone.replace("+", "");

  return (
    <a
      href={`https://wa.me/${waNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("whatsapp")}
      className="fixed bottom-4 end-4 z-40 inline-flex min-h-touch min-w-touch items-center gap-2 rounded-full bg-success px-4 py-3 font-bold text-white shadow-card transition-transform hover:scale-105"
    >
      <MessageCircle aria-hidden="true" className="h-5 w-5" />
      <span className="hidden sm:inline">{t("whatsapp")}</span>
    </a>
  );
}
