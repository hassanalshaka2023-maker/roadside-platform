import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminShell, type AdminNavItem } from "@/components/layout/AdminShell";
import { requireAdmin } from "@/lib/auth/current-user";
import { can, type Permission } from "@/lib/auth/permissions";

/**
 * Admin area shell.
 *
 * The guard here covers the whole panel, and every page underneath still
 * performs its own check - a layout is not a security boundary either, since
 * Next can serve a page without re-running a cached layout.
 *
 * `/admin/login` deliberately lives OUTSIDE this route group, or signing in
 * would redirect to itself forever.
 */
export default async function AdminPanelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireAdmin(locale);
  const t = await getTranslations("admin");

  // Permission-driven navigation: a dispatcher is never even offered the
  // links they cannot open.
  const candidates: Array<{ href: string; label: string; permission?: Permission }> = [
    { href: "/admin", label: t("dashboard") },
    { href: "/admin/requests", label: t("requests"), permission: "viewAllRequests" },
    { href: "/admin/complaints", label: t("complaints"), permission: "manageComplaints" },
    {
      href: "/admin/applications",
      label: t("applications"),
      permission: "viewProviderApplications",
    },
    { href: "/admin/providers", label: t("providers"), permission: "viewProviders" },
    { href: "/admin/customers", label: t("customers"), permission: "viewCustomers" },
    { href: "/admin/audit", label: t("auditLog"), permission: "viewAuditLog" },
    { href: "/admin/settings", label: t("settings"), permission: "manageSettings" },
  ];

  const navItems: AdminNavItem[] = candidates
    .filter((item) => !item.permission || can(user, item.permission))
    .map(({ href, label }) => ({ href, label }));

  const levelLabel =
    user.adminLevel === "SUPER_ADMIN" ? t("levelSuperAdmin") : t("levelDispatcher");

  return (
    <AdminShell
      navItems={navItems}
      userName={user.name ?? user.email ?? ""}
      levelLabel={levelLabel}
    >
      {children}
    </AdminShell>
  );
}
