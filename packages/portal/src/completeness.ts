// The completeness indicator, and the gap that is the pitch.
//
// Every unverified field renders as a visible gap rather than being hidden, because the gap is
// the entire argument for filling the form in: a specialist who cannot see what is missing has no
// reason to spend thirty seconds on it.
//
// The score is weighted by what a referring GP actually needs, so a practice that fills in
// bulk-billing and leaves books-open blank does not get to look 90% done.

import { ACCESS_FIELD_COPY, freshness, type AccessFieldKey, type AccessRecord } from "@referral/core";

export const COMPLETENESS_WEIGHT: Readonly<Record<AccessFieldKey, number>> = {
  booksOpen: 1.4,
  waitToConsultDays: 1.2,
  workcover: 1.0,
  tac: 1.0,
  noGapFunds: 1.0,
  ctp: 0.8,
  dva: 0.8,
  waitToSurgeryDays: 0.8,
  comcare: 0.6,
  bulkBillsInitial: 0.4,
};

export interface Gap {
  readonly key: AccessFieldKey;
  readonly label: string;
  /** What a GP filtering on this field currently sees. Written to be read by the specialist. */
  readonly consequence: string;
}

export interface Completeness {
  /** 0-100, weighted by what a referrer needs rather than by field count. */
  readonly percent: number;
  readonly gaps: readonly Gap[];
}

function consequenceFor(key: AccessFieldKey, state: string): string {
  const label = ACCESS_FIELD_COPY[key];
  if (state === "unknown") {
    return `GPs filtering on ${label} cannot see you as accepting it — your record says not confirmed.`;
  }
  return `Your ${label} answer is ageing, so it counts for less than a recent one.`;
}

export function completenessOf(record: AccessRecord, now: Date): Completeness {
  let earned = 0;
  let total = 0;
  const gaps: Gap[] = [];

  for (const [key, weight] of Object.entries(COMPLETENESS_WEIGHT) as [AccessFieldKey, number][]) {
    total += weight;
    const state = freshness(key, record[key], now);
    if (state === "fresh") {
      earned += weight;
      continue;
    }
    if (state === "ageing") earned += weight * 0.5;
    gaps.push({ key, label: ACCESS_FIELD_COPY[key], consequence: consequenceFor(key, state) });
  }

  return {
    percent: Math.round((earned / total) * 100),
    // Heaviest gap first: the one worth thirty seconds is the one at the top.
    gaps: gaps.sort((a, b) => COMPLETENESS_WEIGHT[b.key] - COMPLETENESS_WEIGHT[a.key]),
  };
}
