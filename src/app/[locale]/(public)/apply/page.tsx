import { setRequestLocale } from "next-intl/server";

import { ComingSoon } from "@/components/layout/ComingSoon";

/** The provider application flow is phase 4. */
export default async function ApplyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ComingSoon />;
}
