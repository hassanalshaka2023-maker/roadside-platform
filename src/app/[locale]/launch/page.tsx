import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * Where the installed app opens (manifest start_url). Sends each person
 * straight to their own place instead of the public home page:
 * a provider to their dashboard, staff to the admin area, everyone else
 * (customers, signed-out visitors) to the home page with "request help".
 */
export default async function LaunchPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentUser();

  if (user?.role === "PROVIDER") redirect(`/${locale}/provider`);
  if (user?.role === "ADMIN") redirect(`/${locale}/admin`);
  redirect(`/${locale}`);
}
