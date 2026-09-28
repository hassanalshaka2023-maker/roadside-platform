"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

/** The provider area's tabs, with the current one marked. */
export function ProviderTabs({ label, items }: { label: string; items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto px-3">
      {items.map((item) => {
        const active =
          pathname === item.href || (item.href !== "/provider" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-touch shrink-0 items-center border-b-4 px-3 text-sm font-bold transition-colors",
              active ? "border-brand-yellow text-white" : "border-transparent text-gray-400 hover:text-white",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
