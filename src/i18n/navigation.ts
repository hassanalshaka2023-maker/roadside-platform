import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Locale-aware replacements for next/link and next/navigation.
 * Always import Link and useRouter from here, never from next/*, or the
 * locale prefix gets lost on navigation.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
