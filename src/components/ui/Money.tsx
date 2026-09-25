import { useLocale } from "next-intl";

import { formatSyp } from "@/lib/money";

/** An amount in Syrian pounds, with Latin digits and a fixed direction. */
export function Money({ amount, className }: { amount: number; className?: string }) {
  const locale = useLocale();
  return (
    <bdi dir="ltr" className={`numeric whitespace-nowrap ${className ?? ""}`}>
      {formatSyp(amount, locale)}
    </bdi>
  );
}
