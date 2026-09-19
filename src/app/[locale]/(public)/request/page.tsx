import { setRequestLocale } from "next-intl/server";

import { ComingSoon } from "@/components/layout/ComingSoon";

/** The customer request flow is phase 3. */
export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ComingSoon />;
}
