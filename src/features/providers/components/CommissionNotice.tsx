import { getFormatter, getTranslations } from "next-intl/server";

import { Notice } from "@/components/ui/States";
import { bpsToPercent } from "@/lib/money";
import { effectiveCommission, readSetting } from "@/features/settings/platform";

/**
 * What the platform charges, stated plainly - and any announced change,
 * shown to every provider from the day it is announced until it applies.
 */
export async function CommissionNotice() {
  const [t, format, policy] = await Promise.all([
    getTranslations("provider"),
    getFormatter(),
    readSetting("commissionPolicy"),
  ]);
  const current = effectiveCommission(policy);
  const scheduled = policy.scheduled && new Date(policy.scheduled.effectiveFrom) > new Date() ? policy.scheduled : null;

  return (
    <div className="flex flex-col gap-2">
      {current.enabled && current.rateBps > 0 ? (
        <Notice tone="info">
          {t("commissionCurrent", { rate: bpsToPercent(current.rateBps), base: t(`commissionBase.${current.base}`) })}
        </Notice>
      ) : (
        <Notice tone="success">{t("commissionFree")}</Notice>
      )}
      {scheduled ? (
        <Notice tone="warning" title={t("commissionScheduledTitle")}>
          {scheduled.enabled && scheduled.rateBps > 0
            ? t("commissionScheduled", {
                rate: bpsToPercent(scheduled.rateBps),
                base: t(`commissionBase.${scheduled.base}`),
                date: format.dateTime(new Date(scheduled.effectiveFrom), { dateStyle: "long" }),
              })
            : t("commissionScheduledFree", {
                date: format.dateTime(new Date(scheduled.effectiveFrom), { dateStyle: "long" }),
              })}
        </Notice>
      ) : null}
    </div>
  );
}
