import { ChevronLeft, ChevronRight, KeyRound } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { InstallAppBanner } from "@/components/pwa/InstallAppBanner";
import { NotificationToggle } from "@/components/pwa/NotificationToggle";
import { vapidPublicKey } from "@/features/notifications/push";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ApplicationStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { listForCustomer, sweepQuietly } from "@/features/requests/service";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { loggerFor } from "@/lib/logger";
import { ContactNumber } from "@/components/ui/ContactNumber";

const log = loggerFor("page/account");

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser(locale, "customer");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;

  await sweepQuietly();
  let requests: Awaited<ReturnType<typeof listForCustomer>> | null = null;
  try {
    requests = await listForCustomer(user.id);
  } catch (error) {
    log.error({ err: error }, "failed to load customer requests");
  }

  const application = await prisma.providerApplication.findUnique({
    where: { userId: user.id },
    select: { status: true, publicReference: true },
  });

  const roleLabel =
    user.role === "ADMIN" ? t("account.roleAdmin") : user.role === "PROVIDER" ? t("account.roleProvider") : t("account.roleCustomer");

  return (
    <div className="container max-w-2xl py-10">
      <h1 className="text-2xl">{t("account.title")}</h1>
      <p className="mb-6 mt-2 text-sm text-gray-600">{t("account.subtitle")}</p>

      <InstallAppBanner className="mb-4" />
      <NotificationToggle publicKey={vapidPublicKey()} audience="customer" className="mb-4" />
      {user.role !== "ADMIN" ? (
        <Link
          href="/account/password"
          className="mb-6 flex min-h-touch items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 font-bold hover:border-ink"
        >
          <span className="flex items-center gap-2">
            <KeyRound aria-hidden="true" className="h-5 w-5" />
            {user.hasPassword ? t("passwordAuth.changeTitle") : t("passwordAuth.setTitle")}
          </span>
          <Chevron aria-hidden="true" className="h-5 w-5" />
        </Link>
      ) : null}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-bold text-gray-600">{t("account.phone")}</span>
            <span className="font-bold">
              <ContactNumber user={user} />
            </span>
          </div>
          {user.email ? (
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-bold text-gray-600">{t("auth.emailLabel")}</span>
              <bdi dir="ltr" className="font-bold">{user.email}</bdi>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-bold text-gray-600">{t("account.role")}</span>
            <Badge tone="yellow">{roleLabel}</Badge>
          </div>
          {user.role === "PROVIDER" ? (
            <Link href="/provider" className="font-bold text-ink underline">
              {t("nav.providerPanel")}
            </Link>
          ) : application ? (
            <div className="flex items-center justify-between gap-4">
              <Link href="/apply" className="text-sm font-bold underline">
                {t("account.myApplication")} ({application.publicReference})
              </Link>
              <ApplicationStatusBadge status={application.status} />
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t("account.myRequests")}</CardTitle>
        </CardHeader>
        <CardBody>
          {requests === null ? (
            <ErrorState title={t("errors.technicalTitle")} text={t("errors.technical")} />
          ) : requests.length === 0 ? (
            <EmptyState
              title={t("account.noRequestsYet")}
              action={
                <Link href="/request" className="inline-flex min-h-touch items-center rounded-lg bg-brand-yellow px-4 font-extrabold text-ink">
                  {t("home.heroCtaRequest")}
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100">
              {requests.map((r) => (
                <li key={r.id}>
                  <Link href={`/track/${r.trackingToken}`} className="flex min-h-touch items-center gap-3 py-3 hover:bg-gray-50">
                    <span className="flex-1">
                      <span className="block font-bold">{locale === "ar" ? r.serviceType.nameAr : r.serviceType.nameEn}</span>
                      <span className="block text-xs text-gray-500">
                        <bdi className="numeric">{r.publicCode}</bdi> · {format.dateTime(r.createdAt, { dateStyle: "medium" })}
                        {r.finalAmountSyp !== null && r.status === "COMPLETED" ? (
                          <>
                            {" · "}
                            <Money amount={r.finalAmountSyp} />
                          </>
                        ) : null}
                      </span>
                    </span>
                    <StatusBadge status={r.status} />
                    <Chevron aria-hidden="true" className="h-4 w-4 text-gray-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
