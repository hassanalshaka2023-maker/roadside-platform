import { Clock, MapPin, Phone } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Logo } from "@/components/ui/Logo";
import { Link } from "@/i18n/navigation";
import { getBusinessPhones } from "@/features/settings/queries";
import { normalizeSyrianPhone, toLocalFormat } from "@/lib/phone";

export async function PublicFooter() {
  const [t, phones] = await Promise.all([getTranslations(), getBusinessPhones()]);

  const valid = phones
    .map((phone) => normalizeSyrianPhone(phone))
    .filter((result) => result.ok)
    .map((result) => (result.ok ? result.phone : ""));

  return (
    <footer className="dark-surface mt-auto bg-navy text-white">
      <div className="hazard-divider" />
      <div className="container grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Logo size="lg" />
          <p className="mt-3 text-sm text-gray-300">{t("brand.sloganSafer")}</p>
        </div>

        <div>
          <h2 className="mb-3 text-base font-extrabold text-brand-yellow">
            {t("home.contactTitle")}
          </h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {valid.map((phone) => (
              <li key={phone}>
                <a
                  href={`tel:${phone}`}
                  dir="ltr"
                  className="numeric inline-flex min-h-touch items-center gap-2 rounded-lg bg-white/5 px-3 font-bold hover:bg-white/10 hover:text-brand-yellow"
                >
                  <Phone aria-hidden="true" className="h-4 w-4 text-brand-yellow" />
                  {toLocalFormat(phone)}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-base font-extrabold text-brand-yellow">
            {t("common.workingHours")}
          </h2>
          <ul className="flex flex-col gap-2 text-sm text-gray-300">
            <li className="flex items-center gap-2">
              <Clock aria-hidden="true" className="h-4 w-4" />
              {t("common.hoursAllDay")}
            </li>
            <li className="flex items-center gap-2">
              <MapPin aria-hidden="true" className="h-4 w-4" />
              {t("common.coverage")}
            </li>
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 border-t border-white/10 py-4 text-xs text-gray-400">
        <span>{t("brand.fullName")}</span>
        <Link href="/terms" className="underline hover:text-white">
          {t("legal.terms.title")}
        </Link>
        <Link href="/privacy" className="underline hover:text-white">
          {t("legal.privacy.title")}
        </Link>
      </div>
    </footer>
  );
}
