import { Construction } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card, CardBody } from "@/components/ui/Card";

/**
 * Honest placeholder for screens that belong to a later phase.
 * Better than a dead link or a 404 on a primary call to action.
 */
export async function ComingSoon({ title }: { title?: string }) {
  const t = await getTranslations("common");

  return (
    <div className="container py-12">
      <Card className="mx-auto max-w-lg text-center">
        <CardBody className="flex flex-col items-center gap-3 py-10">
          <Construction aria-hidden="true" className="h-10 w-10 text-brand-yellow" />
          <h1 className="text-xl">{title ?? t("comingSoonTitle")}</h1>
          <p className="text-gray-600">{t("comingSoonText")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
