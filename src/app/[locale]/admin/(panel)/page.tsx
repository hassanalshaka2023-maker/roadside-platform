import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { Notice } from "@/components/ui/States";
import { getDashboardStats } from "@/features/admin/stats";
import { sweepQuietly } from "@/features/requests/service";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { cn } from "@/lib/cn";

function Stat({ label, value, href, tone }: { label: string; value: React.ReactNode; href?: string; tone?: "warn" }) {
  const body = (
    <div className={cn("rounded-xl border border-gray-200 bg-white p-4", tone === "warn" && "border-warning bg-warning-soft")}>
      <p className="text-sm text-gray-600">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function AdminDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { locale } = await params;
  const { period } = await searchParams;
  setRequestLocale(locale);

  const user = await requireAdmin(locale);
  const t = await getTranslations("admin");
  const days = period === "all" ? null : 30;

  await sweepQuietly();
  const stats = await getDashboardStats(days);
  const n = (value: number) => <bdi className="numeric">{value}</bdi>;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl">{t("title")}</h1>
          <p className="mt-1 text-gray-600">{t("welcome", { name: user.name ?? user.email ?? "" })}</p>
        </div>
        <div className="flex gap-2 text-sm font-bold">
          <Link href="/admin" className={cn("rounded-lg px-3 py-2", days ? "bg-ink text-white" : "bg-white")}>
            {t("period_30")}
          </Link>
          <Link href="/admin?period=all" className={cn("rounded-lg px-3 py-2", !days ? "bg-ink text-white" : "bg-white")}>
            {t("period_all")}
          </Link>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-lg">{t("requestsSection")}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("requestsTotal")} value={n(stats.requests.total)} href="/admin/requests" />
          <Stat label={t("searching")} value={n(stats.requests.searching)} href="/admin/requests?status=SEARCHING" />
          <Stat label={t("active")} value={n(stats.requests.active)} />
          <Stat label={t("completed")} value={n(stats.requests.completed)} href="/admin/requests?status=COMPLETED" />
          <Stat label={t("cancelled")} value={n(stats.requests.cancelled)} />
          <Stat label={t("noProvider")} value={n(stats.requests.noProvider)} href="/admin/requests?status=NO_PROVIDER_AVAILABLE" />
          <Stat label={t("disputed")} value={n(stats.requests.disputed)} href="/admin/requests?status=DISPUTED" tone={stats.requests.disputed > 0 ? "warn" : undefined} />
          <Stat label={t("openComplaints")} value={n(stats.openComplaints)} href="/admin/complaints" tone={stats.openComplaints > 0 ? "warn" : undefined} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg">{t("providersSection")}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label={t("pendingApplications")} value={n(stats.pendingApplications)} href={can(user, "viewProviderApplications") ? "/admin/applications" : undefined} tone={stats.pendingApplications > 0 ? "warn" : undefined} />
          <Stat label={t("activeProviders")} value={n(stats.activeProviders)} />
          <Stat label={t("availableProviders")} value={n(stats.availableProviders)} />
        </div>
      </section>

      {can(user, "viewFinancials") ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("financeSection")}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Stat label={t("serviceValue")} value={<Money amount={stats.serviceValueSyp} />} />
              <Stat label={t("commissionEarned")} value={<Money amount={stats.commissionEarnedSyp} />} />
              <Stat label={t("commissionSettled")} value={<Money amount={stats.commissionSettledSyp} />} />
            </div>
            <Notice tone="info">{t("serviceValueHint")}</Notice>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
