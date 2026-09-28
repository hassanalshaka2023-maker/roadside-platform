import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";

/**
 * Brand mark.
 *
 * IMPORTANT: the real logo (gear + wrench over a road, with the bold "24" and
 * the red clock arrow) must NEVER be redrawn or approximated in code. Until
 * the artwork lands in public/brand/, this renders a typographic placeholder.
 *
 * When the files arrive, swap the inner markup for an <Image> and keep this
 * component's API unchanged, so no call site has to be touched.
 */
export function Logo({
  className,
  onDark = false,
  showTagline = false,
}: {
  className?: string;
  /** Use on the dark header/footer surfaces. */
  onDark?: boolean;
  showTagline?: boolean;
}) {
  const t = useTranslations("brand");

  return (
    <span className={cn("inline-flex flex-col leading-none", className)}>
      <span className="inline-flex items-baseline gap-1.5">
        <span
          className={cn(
            "whitespace-nowrap text-xl font-extrabold tracking-tight sm:text-2xl",
            onDark ? "text-white" : "text-ink",
          )}
        >
          {/* The flyer's red "24", typeset - not a drawing of the logo. */}
          {t("name").replace(/\s*24$/, "")}{" "}
          {/24$/.test(t("name")) ? <span className="text-brand-red">24</span> : null}
        </span>
      </span>
      {showTagline ? (
        <span
          className={cn(
            "mt-1 text-xs font-semibold",
            onDark ? "text-brand-yellow" : "text-gray-600",
          )}
        >
          {t("tagline")}
        </span>
      ) : null}
    </span>
  );
}
