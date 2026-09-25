import { Star } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { EmptyState, Field } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getProviderEarnings, listCommissionEntries } from "@/features/commission/service";
import { listProviderJobs } from "@/features/jobs/queries";
import { Link } from "@/i18n/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { bpsToPercent } from "@/lib/money";

export default async function ProviderHistoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireRole(locale, ["PROVIDER"], "customer");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const [jobs, earnings, entries] = await Promise.all([
    listProviderJobs(user.id, "history"),
    getProviderEarnings(user.id),
    listCommissionEntries(user.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("provider.history.earnings")}</CardTitle>
        </CardHeader>
        <CardBody>
          <dl>
            <Field label={t("provider.history.completedJobs")}>
              <bdi className="numeric">{earnings.completedJobs}</bdi>
            </Field>
            <Field label={t("provider.history.serviceValue")}><Money amount={earnings.serviceValueSyp} /></Field>
            <Field label={t("provider.history.commissionDue")}><Money amount={earnings.commissionDueSyp} /></Field>
            <Field label={t("provider.history.commissionSettled")}><Money amount={earnings.commissionSettledSyp} /></Field>
          </dl>
          <p className="mt-2 text-xs text-gray-500">{t("provider.history.cashNote")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("provider.history.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          {jobs.length === 0 ? (
            <EmptyState title={t("provider.history.empty")} />
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100">
              {jobs.map((job) => (
                <li key={job.id}>
                  <Link href={`/provider/jobs/${job.id}`} className="flex min-h-touch items-center gap-3 py-3">
                    <span className="flex-1">
                      <span className="block font-bold">{locale === "ar" ? job.serviceType.nameAr : job.serviceType.nameEn}</span>
                      <span className="block text-xs text-gray-500">
                        <bdi className="numeric">{job.publicCode}</bdi> · {format.dateTime(job.completedAt ?? job.createdAt, { dateStyle: "medium" })}
                        {job.rating ? (
                          <>
                            {" · "}
                            <Star aria-hidden="true" className="inline h-3 w-3 fill-brand-yellow text-brand-yellow" /> {job.rating.stars}
                          </>
                        ) : null}
                      </span>
                    </span>
                    {job.status === "COMPLETED" && job.finalAmountSyp !== null ? <Money amount={job.finalAmountSyp} className="font-bold" /> : null}
                    <StatusBadge status={job.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {entries.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("provider.history.ledger")}</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-2 text-sm">
              {entries.map((entry) => (
                <li key={entry.id} className="flex justify-between gap-2">
                  <span>
                    <bdi className="numeric">{entry.request.publicCode}</bdi> · {bpsToPercent(entry.rateBps)}%
                  </span>
                  <span>
                    <Money amount={entry.amountSyp} /> · {t(`commissionStatus.${entry.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
