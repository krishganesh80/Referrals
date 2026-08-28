// What converts verification from a treadmill into a targeted operation.
//
// Calling in weight order is the right way to START. It is the wrong way to CONTINUE, because
// after the first pass most of the queue is records we already confirmed and nothing has changed.
// This finds the records most likely to be WRONG, and those go to the front — over time they
// should be nearly the whole queue.
//
// ONE BOUNDARY WORTH STATING. Outcome signals arrive here as already-suppressed published cells.
// This module never sees a raw ping and cannot reach the signals store; a cell below the
// k-anonymity threshold does not exist as far as this code is concerned, and the type says so.

import { ageInDays, freshness, isSelfReported, type AccessField, type Surgeon } from "@referral/core";

/** The shape `@referral/signals` publishes after suppression. Structurally typed on purpose. */
export interface PublishedOutcomeCell {
  readonly surgeonId: string;
  readonly weekBucket: string;
  readonly accepted: number;
  readonly declined: number;
  readonly noResponse: number;
  readonly distinctInstalls: number;
}

export const DISCREPANCY_KINDS = [
  "books-open-contradicted-by-outcomes",
  "wait-shorter-than-the-platform-shows",
  "fund-listed-by-insurer-not-by-practice",
  "no-confirmation-from-any-channel",
] as const;
export type DiscrepancyKind = (typeof DISCREPANCY_KINDS)[number];

export interface Discrepancy {
  readonly ahpraId: string;
  readonly kind: DiscrepancyKind;
  /** 0-1, how likely the record is wrong. Multiplied by referral weight to rank. */
  readonly confidence: number;
  /** One sentence a caller can read aloud before dialling. */
  readonly statement: string;
  readonly evidence: readonly string[];
}

export interface DiscrepancyInputs {
  /** Next-available derived from a booking platform, keyed by AHPRA id. */
  readonly bookingPlatformWait?: ReadonlyMap<string, AccessField<number>>;
  /** No-gap participation from the funds' own directories, keyed by AHPRA id. */
  readonly insurerDirectoryFunds?: ReadonlyMap<string, readonly string[]>;
  /** Suppressed aggregate outcome cells. Never raw pings. */
  readonly outcomeCells?: readonly PublishedOutcomeCell[];
}

/** A decline rate above this, against a claim that books are open, is worth a call. */
export const DECLINE_RATE_THRESHOLD = 0.5;
/** Minimum referrals in a cell before its decline rate is treated as signal rather than noise. */
export const MIN_REFERRALS_FOR_RATE = 8;
/** How much longer the platform's wait must be than the practice's claim, as a ratio. */
export const WAIT_DISAGREEMENT_RATIO = 2;

function declineRate(cells: readonly PublishedOutcomeCell[]): { rate: number; total: number } {
  let declined = 0;
  let total = 0;
  for (const cell of cells) {
    declined += cell.declined;
    total += cell.accepted + cell.declined + cell.noResponse;
  }
  return { rate: total === 0 ? 0 : declined / total, total };
}

export function detectDiscrepancies(
  surgeons: readonly Surgeon[],
  inputs: DiscrepancyInputs,
  now: Date,
): Discrepancy[] {
  const cellsBySurgeon = new Map<string, PublishedOutcomeCell[]>();
  for (const cell of inputs.outcomeCells ?? []) {
    const list = cellsBySurgeon.get(cell.surgeonId) ?? [];
    list.push(cell);
    cellsBySurgeon.set(cell.surgeonId, list);
  }

  const found: Discrepancy[] = [];

  for (const surgeon of surgeons) {
    const id = surgeon.ahpraId;
    const access = surgeon.access;

    // 1. The practice says its books are open; referrals to them are mostly being declined.
    const cells = cellsBySurgeon.get(id) ?? [];
    if (access.booksOpen.value === true && cells.length > 0) {
      const { rate, total } = declineRate(cells);
      if (total >= MIN_REFERRALS_FOR_RATE && rate > DECLINE_RATE_THRESHOLD) {
        found.push({
          ahpraId: id,
          kind: "books-open-contradicted-by-outcomes",
          confidence: Math.min(1, rate),
          statement: `Record says books are open, but ${Math.round(rate * 100)}% of referrals came back declined.`,
          evidence: [
            `books open — ${isSelfReported(access.booksOpen) ? "self-reported" : "from " + access.booksOpen.source}, confirmed ${ageInDays(access.booksOpen.confirmedAt, now)} days ago`,
            `${total} referral outcomes across ${cells.length} weeks, ${Math.round(rate * 100)}% declined`,
          ],
        });
      }
    }

    // 2. The practice's wait is much shorter than the platform's next available.
    const platform = inputs.bookingPlatformWait?.get(id);
    const claimed = access.waitToConsultDays;
    if (
      platform &&
      typeof platform.value === "number" &&
      typeof claimed.value === "number" &&
      isSelfReported(claimed) &&
      platform.value >= claimed.value * WAIT_DISAGREEMENT_RATIO
    ) {
      found.push({
        ahpraId: id,
        kind: "wait-shorter-than-the-platform-shows",
        confidence: Math.min(1, platform.value / Math.max(1, claimed.value) / 4),
        statement: `Practice reports a ${claimed.value}-day wait; the booking platform's next available is ${platform.value} days.`,
        evidence: [
          `self-reported ${claimed.value} days, confirmed ${ageInDays(claimed.confirmedAt, now)} days ago`,
          `booking platform ${platform.value} days, confirmed ${ageInDays(platform.confirmedAt, now)} days ago`,
        ],
      });
    }

    // 3. A fund's own directory lists them; our record does not.
    const directoryFunds = inputs.insurerDirectoryFunds?.get(id);
    if (directoryFunds && directoryFunds.length > 0) {
      const held = access.noGapFunds.value === "unknown" ? [] : access.noGapFunds.value;
      const missing = directoryFunds.filter((f) => !held.includes(f));
      if (missing.length > 0) {
        found.push({
          ahpraId: id,
          kind: "fund-listed-by-insurer-not-by-practice",
          confidence: 0.7,
          statement: `${missing.join(", ")} list this surgeon for no-gap; our record does not.`,
          evidence: [
            `insurer directories: ${directoryFunds.join(", ")}`,
            `our record: ${held.length === 0 ? "none listed" : held.join(", ")}`,
          ],
        });
      }
    }

    // 4. Nothing from any channel, past the point where any of it can be trusted.
    const everyFieldCold = (["booksOpen", "waitToConsultDays", "workcover"] as const).every((key) => {
      const state = freshness(key, access[key], now);
      return state === "unknown" || state === "stale";
    });
    if (everyFieldCold) {
      found.push({
        ahpraId: id,
        kind: "no-confirmation-from-any-channel",
        confidence: 0.6,
        statement: "No channel has confirmed books, wait or payer acceptance inside its half-life.",
        evidence: (["booksOpen", "waitToConsultDays", "workcover"] as const).map(
          (key) => `${key}: ${freshness(key, access[key], now)}`,
        ),
      });
    }
  }

  return found;
}

/**
 * The queue the brief asks for: discrepancies first, then never-verified high-weight records.
 * Over time the first set should dominate, which is the whole point of the detector.
 */
export function rankDiscrepancies(
  discrepancies: readonly Discrepancy[],
  referralWeights: ReadonlyMap<string, number>,
): Discrepancy[] {
  return [...discrepancies].sort((a, b) => {
    const scoreA = a.confidence * (referralWeights.get(a.ahpraId) ?? 0);
    const scoreB = b.confidence * (referralWeights.get(b.ahpraId) ?? 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.ahpraId === b.ahpraId ? a.kind.localeCompare(b.kind) : a.ahpraId.localeCompare(b.ahpraId);
  });
}
