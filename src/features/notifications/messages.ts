/**
 * The words and link of every push notification, per language.
 *
 * Pure (no database, no Next.js) so each notification can be unit-tested.
 * Texts live in messages/{ar,en}.json under "push"; this module only picks
 * the key, fills in the values and builds the link.
 *
 * Privacy: a notification can show on a locked screen, so it never carries
 * a customer's name, phone, plate or exact location - only the service, the
 * governorate and the request code, which is what the provider feed shows
 * anyway.
 */
import { createTranslator } from "next-intl";

import ar from "../../../messages/ar.json";
import en from "../../../messages/en.json";
import { governorateName } from "@/lib/geo";
import { formatSyp } from "@/lib/money";

export type PushLocale = "ar" | "en";

export interface PushPayload {
  title: string;
  body: string;
  /** Path the notification opens, already locale-prefixed. */
  url: string;
  /** Same tag = the newer notification replaces the older one on the phone. */
  tag: string;
}

/** What happened, with just enough data to describe it. */
export type PushEvent =
  // --- to providers -------------------------------------------------------
  | { type: "newRequest"; requestId: string; service: ServiceName; governorate: string | null }
  | { type: "invited"; requestId: string; service: ServiceName; governorate: string | null }
  | { type: "offerAccepted"; requestId: string; publicCode: string; service: ServiceName }
  | { type: "bookingCancelled"; requestId: string; publicCode: string; by: "customer" | "admin" }
  | { type: "extraAnswered"; requestId: string; publicCode: string; approved: boolean }
  | { type: "completionAnswered"; requestId: string; publicCode: string; confirmed: boolean }
  // --- to customers -------------------------------------------------------
  | { type: "newOffer"; trackingToken: string; service: ServiceName; totalSyp: number; etaMinutes: number }
  | { type: "onTheWay"; trackingToken: string; etaMinutes: number | null }
  | { type: "arrived"; trackingToken: string }
  | { type: "awaitingConfirmation"; trackingToken: string; amountSyp: number }
  | { type: "extraProposed"; trackingToken: string; totalSyp: number }
  | { type: "providerWithdrew"; trackingToken: string; searchingAgain: boolean }
  | { type: "searchEnded"; trackingToken: string; anyOffers: boolean };

export interface ServiceName {
  nameAr: string;
  nameEn: string;
}

const MESSAGES = { ar, en } as const;

function translatorFor(locale: PushLocale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "push" });
}

export function normalizePushLocale(locale: string | null | undefined): PushLocale {
  return locale === "en" ? "en" : "ar";
}

export function buildPushPayload(event: PushEvent, locale: PushLocale): PushPayload {
  const t = translatorFor(locale);
  const service = (s: ServiceName) => (locale === "ar" ? s.nameAr : s.nameEn);
  const area = (g: string | null) => governorateName(g, locale) || t("unknownArea");
  const money = (n: number) => formatSyp(n, locale);
  const path = (p: string) => `/${locale}${p}`;

  switch (event.type) {
    case "newRequest":
      return {
        title: t("newRequest.title"),
        body: t("newRequest.body", { service: service(event.service), area: area(event.governorate) }),
        url: path(`/provider/requests/${event.requestId}`),
        tag: `request-${event.requestId}`,
      };
    case "invited":
      return {
        title: t("invited.title"),
        body: t("invited.body", { service: service(event.service), area: area(event.governorate) }),
        url: path(`/provider/requests/${event.requestId}`),
        tag: `request-${event.requestId}`,
      };
    case "offerAccepted":
      return {
        title: t("offerAccepted.title"),
        body: t("offerAccepted.body", { service: service(event.service), code: event.publicCode }),
        url: path(`/provider/jobs/${event.requestId}`),
        tag: `job-${event.requestId}`,
      };
    case "bookingCancelled":
      return {
        title: t("bookingCancelled.title"),
        body: t(event.by === "customer" ? "bookingCancelled.byCustomer" : "bookingCancelled.byAdmin", {
          code: event.publicCode,
        }),
        url: path("/provider"),
        tag: `job-${event.requestId}`,
      };
    case "extraAnswered":
      return {
        title: t(event.approved ? "extraAnswered.approvedTitle" : "extraAnswered.declinedTitle"),
        body: t("extraAnswered.body", { code: event.publicCode }),
        url: path(`/provider/jobs/${event.requestId}`),
        tag: `job-${event.requestId}`,
      };
    case "completionAnswered":
      return {
        title: t(event.confirmed ? "completionAnswered.confirmedTitle" : "completionAnswered.disputedTitle"),
        body: t(event.confirmed ? "completionAnswered.confirmedBody" : "completionAnswered.disputedBody", {
          code: event.publicCode,
        }),
        url: path(`/provider/jobs/${event.requestId}`),
        tag: `job-${event.requestId}`,
      };
    case "newOffer":
      return {
        title: t("newOffer.title"),
        body: t("newOffer.body", {
          service: service(event.service),
          total: money(event.totalSyp),
          eta: event.etaMinutes,
        }),
        url: path(`/track/${event.trackingToken}`),
        tag: `track-${event.trackingToken}-offers`,
      };
    case "onTheWay":
      return {
        title: t("onTheWay.title"),
        body:
          event.etaMinutes !== null
            ? t("onTheWay.bodyEta", { eta: event.etaMinutes })
            : t("onTheWay.body"),
        url: path(`/track/${event.trackingToken}`),
        tag: `track-${event.trackingToken}`,
      };
    case "arrived":
      return {
        title: t("arrived.title"),
        body: t("arrived.body"),
        url: path(`/track/${event.trackingToken}`),
        tag: `track-${event.trackingToken}`,
      };
    case "awaitingConfirmation":
      return {
        title: t("awaitingConfirmation.title"),
        body: t("awaitingConfirmation.body", { amount: money(event.amountSyp) }),
        url: path(`/track/${event.trackingToken}`),
        tag: `track-${event.trackingToken}`,
      };
    case "extraProposed":
      return {
        title: t("extraProposed.title"),
        body: t("extraProposed.body", { total: money(event.totalSyp) }),
        url: path(`/track/${event.trackingToken}`),
        tag: `track-${event.trackingToken}-extra`,
      };
    case "providerWithdrew":
      return {
        title: t("providerWithdrew.title"),
        body: t(event.searchingAgain ? "providerWithdrew.searching" : "providerWithdrew.cancelled"),
        url: path(`/track/${event.trackingToken}`),
        tag: `track-${event.trackingToken}`,
      };
    case "searchEnded":
      return {
        title: t(event.anyOffers ? "searchEnded.expiredTitle" : "searchEnded.noProviderTitle"),
        body: t(event.anyOffers ? "searchEnded.expiredBody" : "searchEnded.noProviderBody"),
        url: path(`/track/${event.trackingToken}`),
        tag: `track-${event.trackingToken}`,
      };
  }
}
