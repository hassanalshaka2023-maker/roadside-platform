/**
 * Money helpers.
 *
 * Every amount in the system is an INTEGER number of Syrian pounds. There are
 * no fractions: prices are quoted in whole pounds, and keeping them integers
 * means no floating-point rounding ever touches a bill.
 *
 * Pure and dependency-free, so it is safe on both server and client.
 */

/** Largest single amount we accept: well under the Postgres INT limit. */
export const MAX_AMOUNT_SYP = 1_000_000_000;

/** Basis points: 10000 bps = 100%. Integer, so rates are exact too. */
export const BPS_PER_WHOLE = 10_000;

export function isValidAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_AMOUNT_SYP
  );
}

/** Sums amounts, refusing anything that is not a valid whole amount. */
export function sumSyp(...amounts: number[]): number {
  let total = 0;
  for (const amount of amounts) {
    if (!isValidAmount(amount)) throw new RangeError(`Invalid amount: ${amount}`);
    total += amount;
  }
  if (total > MAX_AMOUNT_SYP) throw new RangeError("Total exceeds the maximum amount");
  return total;
}

/**
 * Commission for an amount at a rate in basis points.
 *
 * Rounded DOWN to a whole pound: when in doubt, the provider keeps the
 * fraction. Integer arithmetic throughout - `amount * bps` stays far below
 * Number.MAX_SAFE_INTEGER for any amount we accept.
 */
export function commissionFor(amountSyp: number, rateBps: number): number {
  if (!isValidAmount(amountSyp)) throw new RangeError(`Invalid amount: ${amountSyp}`);
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > BPS_PER_WHOLE) {
    throw new RangeError(`Invalid rate: ${rateBps}`);
  }
  return Math.floor((amountSyp * rateBps) / BPS_PER_WHOLE);
}

/** "12.5" (percent) -> 1250 bps. Returns null for anything unparseable. */
export function percentToBps(percent: string | number): number | null {
  const text = String(percent).trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bps <= BPS_PER_WHOLE ? bps : null;
}

export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

/**
 * Parses what a person typed into an amount field. Accepts Arabic-Indic
 * digits and thousands separators, because that is how people type prices on
 * Arabic keyboards. Returns null for anything that is not a whole amount.
 */
export function parseAmountInput(raw: string): number | null {
  const western = raw
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\s,،٬']/g, "")
    .trim();
  if (western === "") return null;
  if (!/^\d+$/.test(western)) return null;
  const value = Number(western);
  return isValidAmount(value) ? value : null;
}

/** "150000" -> "150,000" in Latin digits, which read best for prices here. */
export function formatSyp(amount: number, locale: string = "ar"): string {
  const digits = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
  return locale === "ar" ? `${digits} ل.س` : `SYP ${digits}`;
}
