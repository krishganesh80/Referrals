// How much GP referral volume a surgeon absorbs, from public signals only.
//
// We will not verify 1,500 surgeons by phone. We verify in descending order of how much referral
// volume each one absorbs, so the launch goal is coverage of VOLUME rather than headcount — a
// queue reporting "412 of 1500 verified" is measuring the wrong thing and flatters itself.
//
// PUBLIC SIGNALS ONLY, AND NOTHING THAT RANKS A PERSON. Every input below is an observable fact
// about a practice's footprint: how many hospitals appoint them, how many rooms they consult
// from, how many funds list them, how large the practice is, how long they have been registered.
// None of it is a judgement about the surgeon and none of it reaches the matcher — this score
// decides who we PHONE, never who a GP sees first.

import type { Surgeon } from "@referral/core";

export const REFERRAL_WEIGHT_FACTORS = {
  /** Hospital appointments, public and private. The strongest footprint signal we can see. */
  hospitalAppointments: 0.32,
  /** Listed across several funds' no-gap directories — a proxy for private throughput. */
  insurerDirectoryPresence: 0.24,
  /** How many surgeons consult from the same rooms. */
  practiceSize: 0.16,
  /** How many places they consult from at all. */
  locationCount: 0.16,
  /** Years since specialist registration. Weakest by design: a long career is not volume. */
  yearsSinceRegistration: 0.12,
} as const;

/** Saturating curve: the first few of anything matter far more than the tenth. */
function saturate(value: number, halfway: number): number {
  if (value <= 0) return 0;
  return value / (value + halfway);
}

/** A rooms location identifies a practice by where it is, since ids differ between sources. */
export function practiceKey(location: { name: string; postcode: string }): string {
  return `${location.name.trim().toLowerCase()}|${location.postcode}`;
}

/** How many surgeons consult from each set of rooms, across the whole directory. */
export function practiceSizes(surgeons: readonly Surgeon[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const surgeon of surgeons) {
    const keys = new Set(
      surgeon.locations.filter((l) => l.kind === "rooms").map((l) => practiceKey(l)),
    );
    for (const key of keys) sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  return sizes;
}

export interface WeightBreakdown {
  readonly hospitalAppointments: number;
  readonly insurerDirectoryPresence: number;
  readonly practiceSize: number;
  readonly locationCount: number;
  readonly yearsSinceRegistration: number;
  readonly total: number;
}

export function referralWeightFor(
  surgeon: Surgeon,
  sizes: ReadonlyMap<string, number>,
  now: Date,
): WeightBreakdown {
  const hospitals = new Set(
    surgeon.locations.filter((l) => l.kind === "operating").map((l) => practiceKey(l)),
  ).size;

  const funds = surgeon.access.noGapFunds.value;
  const fundCount = funds === "unknown" ? 0 : funds.length;

  const size = Math.max(
    0,
    ...surgeon.locations.filter((l) => l.kind === "rooms").map((l) => sizes.get(practiceKey(l)) ?? 0),
  );

  const years =
    (now.getTime() - Date.parse(`${surgeon.specialistRegistration.since}T00:00:00.000Z`)) /
    (365.25 * 86_400_000);

  const parts = {
    hospitalAppointments: saturate(hospitals, 2),
    insurerDirectoryPresence: saturate(fundCount, 2),
    practiceSize: saturate(Math.max(0, size - 1), 3),
    locationCount: saturate(surgeon.locations.length, 3),
    yearsSinceRegistration: saturate(Math.max(0, years), 12),
  };

  const total =
    parts.hospitalAppointments * REFERRAL_WEIGHT_FACTORS.hospitalAppointments +
    parts.insurerDirectoryPresence * REFERRAL_WEIGHT_FACTORS.insurerDirectoryPresence +
    parts.practiceSize * REFERRAL_WEIGHT_FACTORS.practiceSize +
    parts.locationCount * REFERRAL_WEIGHT_FACTORS.locationCount +
    parts.yearsSinceRegistration * REFERRAL_WEIGHT_FACTORS.yearsSinceRegistration;

  // Rounded so the same directory always produces the same queue order.
  return { ...parts, total: Math.round(Math.min(1, total) * 1e6) / 1e6 };
}

/** Stamps `referralWeight` onto every surgeon. Practice size needs the whole set at once. */
export function withReferralWeights(surgeons: readonly Surgeon[], now: Date): Surgeon[] {
  const sizes = practiceSizes(surgeons);
  return surgeons.map((surgeon) => ({
    ...surgeon,
    referralWeight: referralWeightFor(surgeon, sizes, now).total,
  }));
}
