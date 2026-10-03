/**
 * Typed platform settings.
 *
 * Every admin-editable knob is declared here with a zod schema and a safe
 * default. Reads never throw: a missing or malformed row falls back to the
 * default (and is logged), so a bad edit cannot take the site down.
 */
import "server-only";

import { z } from "zod";

import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { loggerFor } from "@/lib/logger";
import { BPS_PER_WHOLE } from "@/lib/money";

const log = loggerFor("settings/platform");

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export const commissionTermsSchema = z.object({
  enabled: z.boolean(),
  /** 0..5000 bps (0%..50%). */
  rateBps: z.number().int().min(0).max(BPS_PER_WHOLE / 2),
  base: z.enum(["TOTAL", "LABOR"]),
});
export type CommissionTerms = z.infer<typeof commissionTermsSchema>;

/**
 * The policy in force, plus at most one announced change.
 *
 * A change is never immediate: it is scheduled for a date at least
 * `commissionNoticeDays` away and shown to every provider until then, so no
 * one discovers a new fee after the fact.
 */
export const commissionPolicySchema = z.object({
  current: commissionTermsSchema,
  scheduled: commissionTermsSchema
    .extend({
      effectiveFrom: z.iso.datetime(),
      announcedAt: z.iso.datetime(),
    })
    .nullable(),
});
export type CommissionPolicy = z.infer<typeof commissionPolicySchema>;

export const FREE_COMMISSION: CommissionTerms = { enabled: false, rateBps: 0, base: "TOTAL" };

/** The terms that apply at `now`, promoting a scheduled change once due. */
export function effectiveCommission(policy: CommissionPolicy, now: Date = new Date()): CommissionTerms {
  if (policy.scheduled && new Date(policy.scheduled.effectiveFrom) <= now) {
    const { enabled, rateBps, base } = policy.scheduled;
    return { enabled, rateBps, base };
  }
  return policy.current;
}

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

const SETTING_SCHEMAS = {
  /** Max distance between a provider's base and a request. */
  searchRadiusKm: z.number().int().min(1).max(500),
  /** How long a request stays SEARCHING before it times out. */
  searchTimeoutMinutes: z.number().int().min(5).max(24 * 60),
  /** Default validity of a provider's offer. */
  offerValidityMinutes: z.number().int().min(5).max(24 * 60),
  /** Stops a request drowning in offers. */
  maxOffersPerRequest: z.number().int().min(1).max(20),
  commissionPolicy: commissionPolicySchema,
  commissionNoticeDays: z.number().int().min(1).max(90),
  /** Shown before the customer confirms, and on the terms page. */
  cancellationPolicy: z.object({ ar: z.string().max(2000), en: z.string().max(2000) }),
  customerIdMode: z.enum(["NEVER", "FIRST_REQUEST_ONLY", "ALWAYS"]),
  businessPhones: z.array(z.string().regex(/^0\d{9}$/)).max(5),
  whatsappEnabled: z.boolean(),
  /** The number a customer is told to call when no offer has come in yet. */
  hotlinePhone: z.string().regex(/^0\d{9}$/),
  /** Minutes without any offer before the customer sees "call us". */
  noOfferHelpMinutes: z.number().int().min(1).max(60),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  searchRadiusKm: 30,
  searchTimeoutMinutes: 20,
  offerValidityMinutes: 15,
  maxOffersPerRequest: 5,
  commissionPolicy: { current: FREE_COMMISSION, scheduled: null },
  commissionNoticeDays: 14,
  cancellationPolicy: {
    ar: "يمكنك إلغاء الطلب مجاناً قبل وصول مقدّم الخدمة. بعد الوصول، يتواصل معك فريقنا لحلّ الموضوع. لا توجد غرامات إلغاء حالياً.",
    en: "You can cancel for free before the provider arrives. After arrival, our team will contact you to sort it out. There are no cancellation fees at the moment.",
  },
  customerIdMode: "NEVER",
  businessPhones: [],
  whatsappEnabled: true,
  hotlinePhone: "0981488760",
  noOfferHelpMinutes: 5,
};

export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];

export function parseSetting<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> | null {
  const parsed = SETTING_SCHEMAS[key].safeParse(raw);
  return parsed.success ? (parsed.data as SettingValue<K>) : null;
}

export async function readSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    if (!row) return SETTING_DEFAULTS[key];
    const value = parseSetting(key, row.value);
    if (value === null) {
      log.error({ key }, "stored setting failed validation; using default");
      return SETTING_DEFAULTS[key];
    }
    return value;
  } catch (error) {
    log.error({ err: error, key }, "failed to read setting; using default");
    return SETTING_DEFAULTS[key];
  }
}

export interface MatchingSettings {
  searchRadiusKm: number;
  searchTimeoutMinutes: number;
  offerValidityMinutes: number;
  maxOffersPerRequest: number;
}

export async function readMatchingSettings(): Promise<MatchingSettings> {
  const [searchRadiusKm, searchTimeoutMinutes, offerValidityMinutes, maxOffersPerRequest] =
    await Promise.all([
      readSetting("searchRadiusKm"),
      readSetting("searchTimeoutMinutes"),
      readSetting("offerValidityMinutes"),
      readSetting("maxOffersPerRequest"),
    ]);
  return { searchRadiusKm, searchTimeoutMinutes, offerValidityMinutes, maxOffersPerRequest };
}

export class InvalidSettingError extends Error {
  constructor(readonly key: string) {
    super(`Invalid value for setting ${key}`);
    this.name = "InvalidSettingError";
  }
}

/** Validates, stores and audits one setting, with the old value recorded. */
export async function writeSetting<K extends SettingKey>(
  key: K,
  value: unknown,
  actorId: string,
  ip?: string | null,
): Promise<SettingValue<K>> {
  const parsed = parseSetting(key, value);
  if (parsed === null) throw new InvalidSettingError(key);

  const before = await readSetting(key);

  await prisma.setting.upsert({
    where: { key },
    create: { key, value: parsed as object, updatedBy: actorId },
    update: { value: parsed as object, updatedBy: actorId },
  });

  await audit({
    actorId,
    action: key === "commissionPolicy" ? "commission.policy.changed" : "settings.updated",
    entityType: "Setting",
    entityId: key,
    metadata: { key, before, after: parsed },
    ip,
  });

  return parsed;
}

export class CommissionNoticeError extends Error {
  constructor(readonly minDays: number) {
    super(`A commission change needs at least ${minDays} days of notice`);
    this.name = "CommissionNoticeError";
  }
}

/**
 * Announces a commission change for a future date. The earliest allowed date
 * is `commissionNoticeDays` from now, enforced here on the server.
 */
export async function scheduleCommissionChange(params: {
  terms: CommissionTerms;
  effectiveFrom: Date;
  actorId: string;
  ip?: string | null;
  now?: Date;
}): Promise<CommissionPolicy> {
  const now = params.now ?? new Date();
  const noticeDays = await readSetting("commissionNoticeDays");
  const earliest = now.getTime() + noticeDays * 24 * 60 * 60 * 1000;

  if (params.effectiveFrom.getTime() < earliest - 60_000) {
    throw new CommissionNoticeError(noticeDays);
  }

  const policy = await readSetting("commissionPolicy");
  const next: CommissionPolicy = {
    // Fold in a previously scheduled change that has already taken effect.
    current: effectiveCommission(policy, now),
    scheduled: {
      ...commissionTermsSchema.parse(params.terms),
      effectiveFrom: params.effectiveFrom.toISOString(),
      announcedAt: now.toISOString(),
    },
  };

  return writeSetting("commissionPolicy", next, params.actorId, params.ip);
}

/**
 * The first calendar day a new commission may start on, as YYYY-MM-DD. One
 * extra day, so midnight of that date is still past the notice period.
 */
export function earliestCommissionDate(noticeDays: number, now: Date = new Date()): string {
  return new Date(now.getTime() + (noticeDays + 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Withdraws an announced change before it takes effect. */
export async function cancelScheduledCommission(actorId: string, ip?: string | null) {
  const policy = await readSetting("commissionPolicy");
  const now = new Date();
  return writeSetting(
    "commissionPolicy",
    { current: effectiveCommission(policy, now), scheduled: null },
    actorId,
    ip,
  );
}
