import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";

/**
 * Brand mark: the real logo artwork (design/logo.png), served as small WebP
 * files from public/brand/. Never redraw or approximate it in code.
 *
 * The artwork sits on black, so on the dark surfaces it is used on,
 * `mix-blend-lighten` lets that black melt into the ink background instead
 * of showing as a box. The tagline is part of the artwork.
 */
const SIZES = {
  sm: { className: "h-12", sizes: "72px" },
  md: { className: "h-14 sm:h-[4.5rem]", sizes: "(min-width: 640px) 108px, 84px" },
  lg: { className: "h-24", sizes: "144px" },
  xl: { className: "h-32", sizes: "192px" },
} as const;

export function Logo({
  className,
  size = "md",
  priority = false,
}: {
  className?: string;
  size?: keyof typeof SIZES;
  /** Above the fold: load eagerly. */
  priority?: boolean;
}) {
  const t = useTranslations("brand");
  const variant = SIZES[size];

  return (
    // A plain <img> on purpose: three pre-sized WebP files, no image
    // optimisation round-trip on every page for a 7-25 KB asset.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/logo-360.webp"
      srcSet="/brand/logo-180.webp 180w, /brand/logo-360.webp 360w, /brand/logo-540.webp 540w"
      sizes={variant.sizes}
      width={540}
      height={359}
      alt={`${t("name")} - ${t("tagline")}`}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={cn("w-auto select-none mix-blend-lighten", variant.className, className)}
    />
  );
}
