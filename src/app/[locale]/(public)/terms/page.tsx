import { setRequestLocale } from "next-intl/server";

import { LegalPage } from "@/components/layout/LegalPage";

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage page="terms" />;
}
