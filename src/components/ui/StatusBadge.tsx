import { useTranslations } from "next-intl";

import { Badge } from "./Badge";

type Tone = "neutral" | "yellow" | "success" | "warning" | "danger" | "info";

const TONES: Record<string, Tone> = {
  SEARCHING: "yellow",
  CONFIRMED: "info",
  ON_THE_WAY: "info",
  ARRIVED: "info",
  IN_PROGRESS: "info",
  AWAITING_CONFIRMATION: "warning",
  COMPLETED: "success",
  DISPUTED: "danger",
  CANCELLED_BY_CUSTOMER: "neutral",
  CANCELLED_BY_PROVIDER: "neutral",
  CANCELLED_BY_ADMIN: "neutral",
  NO_PROVIDER_AVAILABLE: "warning",
  EXPIRED: "warning",
};

/** A request status, translated and coloured. Works on server and client. */
export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("status");
  return <Badge tone={TONES[status] ?? "neutral"}>{t(status)}</Badge>;
}

const APPLICATION_TONES: Record<string, Tone> = {
  DRAFT: "neutral",
  PENDING_REVIEW: "yellow",
  NEEDS_INFO: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SUSPENDED: "danger",
};

export function ApplicationStatusBadge({ status }: { status: string }) {
  const t = useTranslations("applicationStatus");
  return <Badge tone={APPLICATION_TONES[status] ?? "neutral"}>{t(status)}</Badge>;
}
