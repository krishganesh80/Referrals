// How old a confirmation is, per field, with the half-life that field actually has.
//
// One deviation from the brief's signature, and it is forced: `AccessField` carries no key, and
// the thresholds differ per field, so the function cannot pick a half-life from the field alone.
// The key is therefore the first argument. Flagged to the founder.
//
// The thresholds live in this one object. The UI renders the result as words — "confirmed 12
// days ago" — never as a colour alone.

import type { AccessField, AccessFieldKey, IsoDate } from "./schema";

export type Freshness = "fresh" | "ageing" | "stale" | "unknown";

export interface FreshnessThreshold {
  /** fresh while age in days is strictly less than this */
  readonly freshUnderDays: number;
  /** stale once age in days is strictly greater than this; between the two it is ageing */
  readonly staleOverDays: number;
}

const PAYER_HALF_LIFE: FreshnessThreshold = { freshUnderDays: 180, staleOverDays: 365 };

export const FRESHNESS_THRESHOLDS: Readonly<Record<AccessFieldKey, FreshnessThreshold>> = {
  workcover: PAYER_HALF_LIFE,
  tac: PAYER_HALF_LIFE,
  ctp: PAYER_HALF_LIFE,
  dva: PAYER_HALF_LIFE,
  comcare: PAYER_HALF_LIFE,
  noGapFunds: PAYER_HALF_LIFE,
  // Not given a band in the brief. Filed with payer acceptance for now; it plausibly moves
  // faster than that and may want the books-open band instead. Flagged to the founder.
  bulkBillsInitial: PAYER_HALF_LIFE,
  booksOpen: { freshUnderDays: 21, staleOverDays: 60 },
  waitToConsultDays: { freshUnderDays: 30, staleOverDays: 90 },
  waitToSurgeryDays: { freshUnderDays: 60, staleOverDays: 120 },
};

const MS_PER_DAY = 86_400_000;

/** Whole days between a confirmation date and now. Negative ages (future dates) clamp to 0. */
export function ageInDays(confirmedAt: IsoDate, now: Date): number {
  const then = Date.parse(`${confirmedAt}T00:00:00.000Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return Math.max(0, Math.floor((today - then) / MS_PER_DAY));
}

/**
 * An unconfirmed value is `'unknown'` however recently somebody looked at it. The value
 * short-circuits before any date arithmetic — a field confirmed yesterday to be unknown is
 * still unknown, not fresh.
 */
export function freshness(
  key: AccessFieldKey,
  field: AccessField<unknown>,
  now: Date,
): Freshness {
  if (field.value === "unknown") return "unknown";
  const { freshUnderDays, staleOverDays } = FRESHNESS_THRESHOLDS[key];
  const age = ageInDays(field.confirmedAt, now);
  if (age < freshUnderDays) return "fresh";
  if (age > staleOverDays) return "stale";
  return "ageing";
}
