// rankByCriteria — pure, no I/O, identical in node and the browser.
//
// The software applies the filters the GP selected to a directory. It does not interpret
// symptoms, infer a diagnosis, or decide anything. Every factor below is a table lookup or an
// arithmetic comparison against a value the GP typed or selected, and every factor that moves a
// surgeon's position emits a clause the UI renders verbatim. There are no hidden weights: if it
// changed the order, it is in `reasons`.
//
// STRUCTURAL GUARANTEE. Each factor returns `{ delta, reasons }` or nothing, and the same
// return is both applied to the score and pushed onto the result. A factor cannot influence the
// rank without saying so, because there is no code path that adds a delta from anywhere else.
//
// THE THREE TUNABLES, AND THE INVARIANT THAT MAKES THEM TESTABLE.
//
//   `UNKNOWN_WEIGHT` (the brief's unknownPayerPenalty) — an unconfirmed payer status must rank
//   below a confirmed acceptance and above an exclusion, without burying the surgeon. At launch
//   most of this dataset is unknown; if the penalty is severe the list collapses onto whoever we
//   phoned first and looks absurdly thin.
//
//   `STALENESS_DECAY` — an ageing or stale confirmation contributes less. A stale `true` must
//   still beat an `unknown`, which is exactly `min(STALENESS_DECAY) > UNKNOWN_WEIGHT`. That
//   inequality is asserted in the test suite, so retuning either number cannot quietly break the
//   rule it exists to enforce.
//
//   `SELF_REPORTED_WAIT_MULTIPLIER` — rooms understate waits. A portal-sourced figure is
//   inflated before it scores. Because that changes the rank, it emits its own clause; the
//   reported figure is still shown verbatim beside it.

import {
  ACCESS_FIELD_COPY,
  PAYER_COPY,
  isSelfReported,
  type AccessField,
  type PayerKey,
  type PracticeLocation,
  type Surgeon,
  PayerKeySchema,
  type EvidenceTier,
} from "./schema";
import { ageInDays, freshness, type Freshness } from "./freshness";
import { describeAge, describeDistance, describeDuration, SOURCE_COPY } from "./phrasing";
import {
  AnatomicalRegionSchema,
  bucketsFor,
  ReferralCategorySchema,
} from "./taxonomy";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Criteria — exactly what the GP selected, and nothing derived from it
// ---------------------------------------------------------------------------

export const CriteriaSchema = z
  .object({
    region: AnatomicalRegionSchema,
    category: ReferralCategorySchema,
    payer: z.union([PayerKeySchema, z.null()]),
    postcode: z.string().regex(/^\d{4}$/),
    maxTravelKm: z.number().positive(),
    sector: z.enum(["public", "private", "either"]),
    fund: z.union([z.string(), z.null()]),
  })
  .strict();
export type Criteria = z.infer<typeof CriteriaSchema>;

/**
 * The postcode centroid, resolved by the caller from the bundle's gazetteer. It is not part of
 * `Criteria` because the GP did not select it — `Criteria` mirrors the selections only. With no
 * origin the distance factor contributes nothing and emits no clause, rather than guessing.
 */
export interface MatchContext {
  readonly origin?: { readonly lat: number; readonly lng: number } | undefined;
}

export interface RankedResult {
  readonly surgeon: Surgeon;
  readonly score: number;
  readonly reasons: string[];
  readonly nearestLocation: PracticeLocation | null;
  readonly distanceKm: number | null;
}

// ---------------------------------------------------------------------------
// Weights — one config object, all of it exported
// ---------------------------------------------------------------------------

export const MATCH_WEIGHTS = {
  subspecialty: 40,
  payer: 25,
  noGapFund: 15,
  booksOpen: 10,
  waitToConsult: 15,
  distance: 20,
  sector: 10,
} as const;

/** How much a tag's evidence tier is worth, as a fraction of the sub-specialty weight. */
export const TIER_WEIGHT: Readonly<Record<EvidenceTier, number>> = {
  A: 1.0,
  B: 0.6,
  S: 0.4,
  C: 0.25,
};

/** First bucket in a taxonomy row is the primary reading; later ones are adjacent practice. */
export const BUCKET_POSITION_WEIGHT = { primary: 1.0, adjacent: 0.6 } as const;

export const STALENESS_DECAY: Readonly<Record<Exclude<Freshness, "unknown">, number>> = {
  fresh: 1.0,
  ageing: 0.8,
  stale: 0.6,
};

/**
 * Binary and set-valued unknowns (payer acceptance, no-gap participation, books open).
 * Held strictly below `min(STALENESS_DECAY)` so a stale confirmation always outranks silence.
 */
export const UNKNOWN_WEIGHT = 0.45;

/**
 * Continuous unknowns (wait times) are scored lower than binary ones, and deliberately below
 * the midpoint of the known range. If an unknown wait scored near the middle, a surgeon who
 * reports a long wait would rank below one who reports nothing, and the portal's entire pitch —
 * fill this in and you appear — would be inverted. At 0.15 a confirmed wait beats silence
 * everywhere except the far tail, where a genuinely six-month wait does lose to "not
 * confirmed". That residual is intended: at that length the unknown really is the better bet.
 */
export const UNKNOWN_WAIT_WEIGHT = 0.15;

/** Rooms understate. A portal figure is inflated by this before it scores. */
export const SELF_REPORTED_WAIT_MULTIPLIER = 1.35;

/** Wait beyond which the wait factor contributes nothing. */
export const WAIT_SATURATION_DAYS = 180;

const TIER_PHRASE: Readonly<Record<EvidenceTier, string>> = {
  A: "verified",
  B: "inferred",
  C: "from practice website",
  S: "self-reported",
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

function nearest(
  surgeon: Surgeon,
  origin: { lat: number; lng: number } | undefined,
): { location: PracticeLocation | null; km: number | null } {
  const first = surgeon.locations[0] ?? null;
  if (!origin) return { location: first, km: null };
  let closest: PracticeLocation | null = null;
  let closestKm = Number.POSITIVE_INFINITY;
  for (const loc of surgeon.locations) {
    const km = haversineKm(origin, loc);
    if (km < closestKm) {
      closestKm = km;
      closest = loc;
    }
  }
  return closest === null ? { location: null, km: null } : { location: closest, km: closestKm };
}

// ---------------------------------------------------------------------------
// Factors
// ---------------------------------------------------------------------------

interface Factor {
  readonly delta: number;
  readonly reasons: readonly string[];
}

const none: Factor = { delta: 0, reasons: [] };

function decay(f: Freshness): number {
  return f === "unknown" ? UNKNOWN_WEIGHT : STALENESS_DECAY[f];
}

function subspecialtyFactor(surgeon: Surgeon, criteria: Criteria): Factor {
  const buckets = bucketsFor(criteria.region, criteria.category);
  if (surgeon.subspecialtyTags.length === 0) {
    // Absence is not a negative. An untagged surgeon is surfaced and said to be untagged;
    // silence about a sub-specialty is not evidence they do not practise it.
    return { delta: 0, reasons: ["No sub-specialty confirmed"] };
  }
  let strongest: Factor | null = null;
  let strongestDelta = -1;
  for (const tag of surgeon.subspecialtyTags) {
    const position = buckets.indexOf(tag.bucket);
    if (position < 0) continue;
    const positionWeight =
      position === 0 ? BUCKET_POSITION_WEIGHT.primary : BUCKET_POSITION_WEIGHT.adjacent;
    const delta = MATCH_WEIGHTS.subspecialty * TIER_WEIGHT[tag.tier] * positionWeight;
    if (delta > strongestDelta) {
      strongestDelta = delta;
      strongest = { delta, reasons: [`${tag.evidence} (${TIER_PHRASE[tag.tier]})`] };
    }
  }
  return strongest ?? none;
}

function payerFactor(
  field: AccessField<boolean | "unknown">,
  key: PayerKey,
  now: Date,
): Factor {
  const label = PAYER_COPY[key];
  if (field.value === "unknown") {
    return {
      delta: MATCH_WEIGHTS.payer * UNKNOWN_WEIGHT,
      reasons: [`${label} status not confirmed`],
    };
  }
  // `false` is excluded upstream by the hard filter; this branch exists so the function is
  // total and so an unfiltered search still explains a declined payer.
  if (field.value === false) {
    return { delta: 0, reasons: [`Does not accept ${label} — confirmed ${describeAge(ageInDays(field.confirmedAt, now))}`] };
  }
  const f = freshness(key, field, now);
  return {
    delta: MATCH_WEIGHTS.payer * decay(f),
    reasons: [`Accepts ${label} — confirmed ${describeAge(ageInDays(field.confirmedAt, now))}`],
  };
}

function noGapFactor(surgeon: Surgeon, fund: string, now: Date): Factor {
  const field = surgeon.access.noGapFunds;
  if (field.value === "unknown") {
    return {
      delta: MATCH_WEIGHTS.noGapFund * UNKNOWN_WEIGHT,
      reasons: ["No-gap fund participation not confirmed"],
    };
  }
  if (!field.value.includes(fund)) {
    return { delta: 0, reasons: [`No-gap with ${fund} not listed`] };
  }
  const f = freshness("noGapFunds", field, now);
  return {
    delta: MATCH_WEIGHTS.noGapFund * decay(f),
    reasons: [`No-gap with ${fund} — ${SOURCE_COPY[field.source]}`],
  };
}

function booksOpenFactor(surgeon: Surgeon, now: Date): Factor {
  const field = surgeon.access.booksOpen;
  if (field.value === "unknown") {
    return {
      delta: MATCH_WEIGHTS.booksOpen * UNKNOWN_WEIGHT,
      reasons: ["Books-open status not confirmed"],
    };
  }
  const age = describeAge(ageInDays(field.confirmedAt, now));
  if (field.value === false) return { delta: 0, reasons: [`Books closed — confirmed ${age}`] };
  return {
    delta: MATCH_WEIGHTS.booksOpen * decay(freshness("booksOpen", field, now)),
    reasons: [`Books open — confirmed ${age}`],
  };
}

function waitFactor(surgeon: Surgeon, now: Date): Factor {
  const field = surgeon.access.waitToConsultDays;
  if (field.value === "unknown") {
    return {
      delta: MATCH_WEIGHTS.waitToConsult * UNKNOWN_WAIT_WEIGHT,
      reasons: ["Wait to consult not confirmed"],
    };
  }
  const reported = field.value;
  const selfReported = isSelfReported(field);
  const ranked = selfReported ? reported * SELF_REPORTED_WAIT_MULTIPLIER : reported;
  const closeness = Math.max(0, 1 - ranked / WAIT_SATURATION_DAYS);
  const f = freshness("waitToConsultDays", field, now);
  const reasons = [
    `${ACCESS_FIELD_COPY.waitToConsultDays} ${describeDuration(reported)} — ${SOURCE_COPY[field.source]}, last updated ${describeAge(ageInDays(field.confirmedAt, now))}`,
  ];
  // The discount changes the order, so it is stated. The reported figure above is untouched.
  if (selfReported) reasons.push("Self-reported wait ranked conservatively");
  return { delta: MATCH_WEIGHTS.waitToConsult * closeness * decay(f), reasons };
}

function distanceFactor(km: number | null, maxTravelKm: number): Factor {
  if (km === null) return none;
  const closeness = Math.max(0, 1 - km / maxTravelKm);
  return { delta: MATCH_WEIGHTS.distance * closeness, reasons: [describeDistance(km)] };
}

function sectorFactor(surgeon: Surgeon, criteria: Criteria): Factor {
  if (criteria.sector === "either") return none;
  const has = surgeon.locations.some((l) => l.sector === criteria.sector);
  return has
    ? { delta: MATCH_WEIGHTS.sector, reasons: [`Consults in the ${criteria.sector} sector`] }
    : { delta: 0, reasons: [`No ${criteria.sector}-sector location listed`] };
}

/**
 * Published waiting times describe a hospital department, not a person. This factor carries
 * ZERO delta by construction: it states the department figure and cannot move the surgeon's
 * position, so no part of the ranking can imply an individual's private wait from a public
 * department's published one.
 */
function publicDepartmentWaitFactor(location: PracticeLocation | null, now: Date): Factor {
  const wait = location?.departmentWait;
  if (!location || !wait || wait.waitToConsultDays.value === "unknown") return none;
  const days = wait.waitToConsultDays.value;
  const age = describeAge(ageInDays(wait.waitToConsultDays.confirmedAt, now));
  return {
    delta: 0,
    reasons: [
      `Public clinic wait at ${location.name} ${describeDuration(days)} — published department figure, not this surgeon's own, last updated ${age}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// rankByCriteria
// ---------------------------------------------------------------------------

/**
 * Hard filters exclude; soft factors score. Two exclusions only, both of them something the GP
 * explicitly asked for:
 *
 *   PAYER EXPLICITLY FALSE. Not unknown — a recorded refusal.
 *
 *   WRONG REGION, for a surgeon whose sub-specialties are known. A surgeon with NO tags is not
 *   excluded: at launch most records carry none, and excluding them would read an absence as a
 *   denial, which is the one thing this product must never do.
 *
 * Travel distance is also hard when an origin is known — the GP set a maximum and meant it.
 * Flagged to the founder as an addition to the brief's list.
 */
export function rankByCriteria(
  surgeons: readonly Surgeon[],
  criteria: Criteria,
  context: MatchContext = {},
  now: Date = new Date(),
): RankedResult[] {
  const buckets = bucketsFor(criteria.region, criteria.category);
  const results: RankedResult[] = [];

  for (const surgeon of surgeons) {
    if (criteria.payer !== null && surgeon.access[criteria.payer].value === false) continue;
    if (
      surgeon.subspecialtyTags.length > 0 &&
      !surgeon.subspecialtyTags.some((t) => buckets.includes(t.bucket))
    ) {
      continue;
    }

    const { location, km } = nearest(surgeon, context.origin);
    if (km !== null && km > criteria.maxTravelKm) continue;

    const factors: Factor[] = [
      subspecialtyFactor(surgeon, criteria),
      criteria.payer !== null
        ? payerFactor(surgeon.access[criteria.payer], criteria.payer, now)
        : none,
      criteria.fund !== null ? noGapFactor(surgeon, criteria.fund, now) : none,
      booksOpenFactor(surgeon, now),
      waitFactor(surgeon, now),
      distanceFactor(km, criteria.maxTravelKm),
      sectorFactor(surgeon, criteria),
      publicDepartmentWaitFactor(location, now),
    ];

    let score = 0;
    const reasons: string[] = [];
    for (const factor of factors) {
      score += factor.delta;
      reasons.push(...factor.reasons);
    }

    results.push({
      surgeon,
      // Rounded so the same bundle and the same criteria produce byte-identical output on any
      // machine, whatever order the floating-point additions happened to take.
      score: Math.round(score * 1e6) / 1e6,
      reasons,
      nearestLocation: location,
      distanceKm: km === null ? null : Math.round(km * 10) / 10,
    });
  }

  // Deterministic: score descending, then AHPRA id ascending. Never insertion order.
  return results.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.surgeon.ahpraId.localeCompare(b.surgeon.ahpraId),
  );
}
