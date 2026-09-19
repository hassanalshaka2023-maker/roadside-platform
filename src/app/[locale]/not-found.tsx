import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

/**
 * Also what an authorized-but-forbidden user sees: the RBAC guards call
 * notFound() rather than exposing a 403, so /admin does not confirm its own
 * existence to a curious customer.
 */
export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-extrabold text-brand-yellow">404</p>
      <h1 className="text-2xl">{t("notFoundTitle")}</h1>
      <p className="max-w-md text-gray-600">{t("notFoundText")}</p>
      <Link
        href="/"
        className="inline-flex min-h-touch items-center rounded-lg bg-brand-yellow px-5 font-extrabold text-ink hover:bg-brand-yellow-hover"
      >
        {t("goHome")}
      </Link>
    </div>
  );
}
