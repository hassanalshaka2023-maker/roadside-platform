import { getTranslations } from "next-intl/server";

import { PublicFooter } from "@/components/layout/PublicFooter";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { WhatsAppButton } from "@/components/layout/WhatsAppButton";
import { InstallAppButton } from "@/components/pwa/InstallAppButton";
import { ToastProvider } from "@/components/ui/Toast";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("nav");

  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col">
        {/* First tab stop: lets keyboard users jump past the header nav. */}
        <a href="#main" className="sr-only-focusable">
          {t("skipToContent")}
        </a>

        <PublicHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <PublicFooter />
        <WhatsAppButton />
        <InstallAppButton />
      </div>
    </ToastProvider>
  );
}
