// Presenting the result of a ranking without presenting a league table.
//
// `rankByCriteria` produces a total order because it has to — the score is how hard filters and
// soft factors combine, and the call queue and the tests need it exact. But a total order shown
// to a GP asserts a precision the underlying data does not have. The difference between a record
// scoring 71.3 and one scoring 70.9 is noise: a fund directory refreshed on a different Tuesday,
// a rooms address geocoded four hundred metres off. Printing them one above the other says the
// first is the better referral, and nothing in the data supports that.
//
// So the list is grouped where the scores genuinely separate, and WITHIN A GROUP THE ORDER IS
// ALPHABETICAL. That is the whole mechanism: alphabetical order is visibly arbitrary, so a reader
// cannot mistake position within a group for a judgement, and the tool stops implying a ranking
// it cannot justify.
//
// Two properties this must not break:
//
//   DETERMINISM. Same bundle, same criteria, same output — every time, on any machine. That rules
//   out shuffling near-ties, which was the other way to weaken the claim. Grouping keeps it.
//
//   THE SEPARATION THAT IS REAL STAYS VISIBLE. A surgeon whose sub-specialty is verified and who
//   confirmed WorkCover last week genuinely is a closer match than one with neither, and hiding
//   that would make the tool useless. Groups are split where the gap is large enough to mean
//   something, and not where it is not.

import type { RankedResult } from "./matcher";

/** A gap smaller than this never splits a group, however the scores fall. */
export const BAND_GAP_FLOOR = 2.5;
/** A gap must also be this fraction of the top score to count as real separation. */
export const BAND_GAP_FRACTION = 0.06;
/** More than three groups stops being a grouping and becomes a ranking again. */
export const MAX_BANDS = 3;

export interface MatchBand {
  readonly key: string;
  readonly label: string;
  readonly results: readonly RankedResult[];
}

const LABELS: Readonly<Record<number, readonly string[]>> = {
  1: ["Matched your criteria"],
  2: ["Closer match to your criteria", "Further from your criteria"],
  3: ["Closest match to your criteria", "Next closest", "Further from your criteria"],
};

/** Visibly arbitrary, and stable: family name, then given names, then the canonical key. */
function alphabetical(a: RankedResult, b: RankedResult): number {
  const family = a.surgeon.familyName.localeCompare(b.surgeon.familyName);
  if (family !== 0) return family;
  const given = a.surgeon.givenNames.localeCompare(b.surgeon.givenNames);
  if (given !== 0) return given;
  return a.surgeon.ahpraId.localeCompare(b.surgeon.ahpraId);
}

export interface BandOptions {
  readonly gapFloor?: number;
  readonly gapFraction?: number;
  readonly maxBands?: number;
}

/**
 * Takes the ordered results and returns groups. Input must already be score-descending, which is
 * what `rankByCriteria` returns.
 */
export function groupIntoBands(
  results: readonly RankedResult[],
  options: BandOptions = {},
): MatchBand[] {
  if (results.length === 0) return [];

  const gapFloor = options.gapFloor ?? BAND_GAP_FLOOR;
  const gapFraction = options.gapFraction ?? BAND_GAP_FRACTION;
  const maxBands = options.maxBands ?? MAX_BANDS;

  const top = results[0]!.score;
  const threshold = Math.max(gapFloor, Math.abs(top) * gapFraction);

  // Every place two consecutive results are far enough apart to mean something.
  const candidates: Array<{ index: number; gap: number }> = [];
  for (let i = 1; i < results.length; i++) {
    const gap = results[i - 1]!.score - results[i]!.score;
    if (gap >= threshold) candidates.push({ index: i, gap });
  }

  // Keep only the widest splits, so three groups at most. Ties on gap break on position, so the
  // choice of split is deterministic rather than dependent on sort stability.
  const splits = candidates
    .sort((a, b) => (b.gap !== a.gap ? b.gap - a.gap : a.index - b.index))
    .slice(0, maxBands - 1)
    .map((c) => c.index)
    .sort((a, b) => a - b);

  const bounds = [0, ...splits, results.length];
  const groups: RankedResult[][] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    groups.push(results.slice(bounds[i]!, bounds[i + 1]!));
  }

  const labels = LABELS[groups.length] ?? LABELS[3]!;
  return groups.map((group, index) => ({
    key: `band-${index}`,
    label: labels[index] ?? "Further from your criteria",
    results: [...group].sort(alphabetical),
  }));
}

/** Flattened band order, for anything that needs the sequence the reader actually sees. */
export function bandedOrder(bands: readonly MatchBand[]): RankedResult[] {
  return bands.flatMap((band) => [...band.results]);
}
