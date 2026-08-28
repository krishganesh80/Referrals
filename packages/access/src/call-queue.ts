// Who to ring next, and how much of the referral volume we would cover by doing it.
//
// THE HEADLINE NUMBER IS VOLUME COVERAGE, NOT HEADCOUNT. "412 of 1500 verified" measures our
// effort; "we can answer the payer question for 71% of the referrals a Melbourne GP actually
// writes" measures whether the product works. The queue reports the second, and projects what
// the next N calls would buy, because that is the number that says when to stop calling.

import {
  ACCESS_FIELD_KEYS,
  freshness,
  haversineKm,
  type AccessFieldKey,
  type Freshness,
  type Surgeon,
} from "@referral/core";
import { suppressionFor, type CallRecord, type Suppression } from "./call-log";
import { referralWeightFor, practiceSizes } from "./referral-weight";

/**
 * How much each field matters to a referral decision. Books-open and the wait lead, because a
 * surgeon who is not taking patients is the one answer that wastes a GP's whole afternoon.
 */
export const FIELD_URGENCY_WEIGHT: Readonly<Record<AccessFieldKey, number>> = {
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

/** How badly a field in each state needs a call. A fresh field needs none. */
export const URGENCY_BY_FRESHNESS: Readonly<Record<Freshness, number>> = {
  unknown: 1.0,
  stale: 0.8,
  ageing: 0.35,
  fresh: 0,
};

const TOTAL_URGENCY_WEIGHT = Object.values(FIELD_URGENCY_WEIGHT).reduce((a, b) => a + b, 0);

/** 0 when every field is fresh, 1 when every field is unconfirmed. */
export function stalenessUrgency(surgeon: Surgeon, now: Date): number {
  let sum = 0;
  for (const key of ACCESS_FIELD_KEYS) {
    sum += FIELD_URGENCY_WEIGHT[key] * URGENCY_BY_FRESHNESS[freshness(key, surgeon.access[key], now)];
  }
  return Math.round((sum / TOTAL_URGENCY_WEIGHT) * 1e6) / 1e6;
}

/** A record counts as covered once its referral-critical fields are not unknown or stale. */
export function isCovered(surgeon: Surgeon, now: Date): boolean {
  return stalenessUrgency(surgeon, now) < 0.25;
}

export interface QueueEntry {
  readonly surgeon: Surgeon;
  readonly referralWeight: number;
  readonly urgency: number;
  readonly score: number;
  /** The fields a caller would actually ask about, in the order the CLI should prompt. */
  readonly fieldsToAsk: readonly AccessFieldKey[];
  readonly suppression: Suppression;
}

export interface Coverage {
  readonly surgeonsInScope: number;
  readonly surgeonsCovered: number;
  /** The number that matters: share of referral volume we can answer for. */
  readonly volumeCoveragePct: number;
  readonly headcountCoveragePct: number;
}

export interface CallQueue {
  readonly entries: readonly QueueEntry[];
  readonly suppressed: readonly QueueEntry[];
  readonly coverageNow: Coverage;
  /** What coverage would become if the whole returned queue were worked through. */
  readonly coverageIfWorked: Coverage;
  /** How many calls to reach the target, or null if the queue cannot get there. */
  readonly callsToTarget: number | null;
}

export interface QueueOptions {
  /** Restrict to a metro: everyone with a location inside the radius of this point. */
  readonly metro?: { readonly lat: number; readonly lng: number; readonly radiusKm: number };
  readonly limit?: number;
  readonly callHistory?: ReadonlyMap<string, readonly CallRecord[]>;
  /** Volume coverage we are aiming for, 0-1. Used to report callsToTarget. */
  readonly targetVolumeCoverage?: number;
}

function inScope(surgeon: Surgeon, metro: QueueOptions["metro"]): boolean {
  if (!metro) return true;
  return surgeon.locations.some((l) => haversineKm(metro, l) <= metro.radiusKm);
}

function coverageOf(weights: ReadonlyMap<string, number>, surgeons: readonly Surgeon[], covered: ReadonlySet<string>): Coverage {
  let total = 0;
  let done = 0;
  for (const surgeon of surgeons) {
    const weight = weights.get(surgeon.ahpraId) ?? 0;
    total += weight;
    if (covered.has(surgeon.ahpraId)) done += weight;
  }
  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
  return {
    surgeonsInScope: surgeons.length,
    surgeonsCovered: covered.size,
    volumeCoveragePct: pct(done, total),
    headcountCoveragePct: pct(covered.size, surgeons.length),
  };
}

export function fieldsWorthAsking(surgeon: Surgeon, now: Date): AccessFieldKey[] {
  return [...ACCESS_FIELD_KEYS]
    .filter((key) => {
      const state = freshness(key, surgeon.access[key], now);
      return state === "unknown" || state === "stale" || state === "ageing";
    })
    .sort((a, b) => FIELD_URGENCY_WEIGHT[b] - FIELD_URGENCY_WEIGHT[a]);
}

export function buildCallQueue(
  surgeons: readonly Surgeon[],
  now: Date,
  options: QueueOptions = {},
): CallQueue {
  const scoped = surgeons.filter((s) => inScope(s, options.metro));
  const sizes = practiceSizes(surgeons);

  const weights = new Map<string, number>(
    scoped.map((s) => [s.ahpraId, referralWeightFor(s, sizes, now).total]),
  );

  const all: QueueEntry[] = scoped.map((surgeon) => {
    const referralWeight = weights.get(surgeon.ahpraId) ?? 0;
    const urgency = stalenessUrgency(surgeon, now);
    return {
      surgeon,
      referralWeight,
      urgency,
      score: Math.round(referralWeight * urgency * 1e6) / 1e6,
      fieldsToAsk: fieldsWorthAsking(surgeon, now),
      suppression: suppressionFor(options.callHistory?.get(surgeon.ahpraId) ?? [], now),
    };
  });

  const ordered = all
    .filter((e) => e.urgency > 0)
    .sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.surgeon.ahpraId.localeCompare(b.surgeon.ahpraId),
    );

  const suppressed = ordered.filter((e) => e.suppression.suppressed);
  const callable = ordered.filter((e) => !e.suppression.suppressed);
  const entries = options.limit === undefined ? callable : callable.slice(0, options.limit);

  const coveredNow = new Set(scoped.filter((s) => isCovered(s, now)).map((s) => s.ahpraId));
  const coverageNow = coverageOf(weights, scoped, coveredNow);

  const coveredAfter = new Set([...coveredNow, ...entries.map((e) => e.surgeon.ahpraId)]);
  const coverageIfWorked = coverageOf(weights, scoped, coveredAfter);

  // How many calls, in queue order, until the target is reached.
  let callsToTarget: number | null = null;
  if (options.targetVolumeCoverage !== undefined) {
    const running = new Set(coveredNow);
    for (const [index, entry] of callable.entries()) {
      running.add(entry.surgeon.ahpraId);
      if (coverageOf(weights, scoped, running).volumeCoveragePct >= options.targetVolumeCoverage * 100) {
        callsToTarget = index + 1;
        break;
      }
    }
  }

  return { entries, suppressed, coverageNow, coverageIfWorked, callsToTarget };
}
