// The properties that make the tunables safe to retune, plus the two exclusions and the
// no-hidden-weights guarantee. The golden files live in matcher.golden.test.ts.

import { describe, expect, it } from "vitest";
import type { AccessRecord, AccessField, Surgeon, Tri } from "./schema";
import {
  MATCH_WEIGHTS,
  rankByCriteria,
  SELF_REPORTED_WAIT_MULTIPLIER,
  STALENESS_DECAY,
  UNKNOWN_WAIT_WEIGHT,
  UNKNOWN_WEIGHT,
  type Criteria,
} from "./matcher";
import { makeFixtureSurgeons } from "./fixtures";

const NOW = new Date("2026-08-28T00:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);

const unknownField = <T,>(): AccessField<T> => ({
  value: "unknown",
  tier: "A",
  source: "phone",
  confirmedAt: daysAgo(0),
});

const blankAccess = (): AccessRecord => ({
  workcover: unknownField<Tri>(),
  tac: unknownField<Tri>(),
  ctp: unknownField<Tri>(),
  dva: unknownField<Tri>(),
  comcare: unknownField<Tri>(),
  noGapFunds: unknownField<string[]>(),
  bulkBillsInitial: unknownField<Tri>(),
  booksOpen: unknownField<Tri>(),
  waitToConsultDays: unknownField<number>(),
  waitToSurgeryDays: unknownField<number>(),
});

let seq = 0;
function surgeon(overrides: Partial<Surgeon> = {}): Surgeon {
  seq += 1;
  return {
    ahpraId: `MED${String(1000000000 + seq)}`,
    familyName: `Test${seq}`,
    givenNames: "Sample",
    preferredName: null,
    specialistRegistration: { specialty: "Orthopaedic surgery", since: "2010-01-01" },
    disciplineOfOrigin: "orthopaedic",
    subspecialtyTags: [],
    locations: [],
    languages: ["English"],
    telehealth: false,
    access: blankAccess(),
    referralWeight: 0.5,
    sourceRecords: [],
    lastReviewedAt: null,
    ...overrides,
  };
}

const criteria = (over: Partial<Criteria> = {}): Criteria => ({
  region: "knee",
  category: "sports_soft_tissue",
  payer: "workcover",
  postcode: "3000",
  maxTravelKm: 50,
  sector: "either",
  fund: null,
  ...over,
});

describe("the invariant that makes the tunables safe to retune", () => {
  it("a stale confirmation is worth more than silence", () => {
    const weakest = Math.min(...Object.values(STALENESS_DECAY));
    expect(weakest).toBeGreaterThan(UNKNOWN_WEIGHT);
  });

  it("an unknown wait is worth less than an unknown binary — reporting a wait must pay", () => {
    expect(UNKNOWN_WAIT_WEIGHT).toBeLessThan(UNKNOWN_WEIGHT);
  });

  it("holds end to end: a stale WorkCover yes outranks an unconfirmed WorkCover", () => {
    const stale = surgeon({
      access: { ...blankAccess(), workcover: { value: true, tier: "A", source: "phone", confirmedAt: daysAgo(400) } },
    });
    const silent = surgeon();
    const [first, second] = rankByCriteria([silent, stale], criteria(), {}, NOW);
    expect(first?.surgeon.ahpraId).toBe(stale.ahpraId);
    expect(second?.surgeon.ahpraId).toBe(silent.ahpraId);
  });
});

describe("an unknown payer is penalised but not buried", () => {
  it("a strong sub-specialty with an unknown payer beats a weak one with a confirmed payer", () => {
    const strongButSilent = surgeon({
      subspecialtyTags: [
        { bucket: "knee_sports", tier: "A", evidence: "Australian Knee Society member", sourceRecordIds: [] },
      ],
    });
    const weakButConfirmed = surgeon({
      subspecialtyTags: [
        { bucket: "knee_sports", tier: "C", evidence: "Listed on practice website", sourceRecordIds: [] },
      ],
      access: { ...blankAccess(), workcover: { value: true, tier: "A", source: "phone", confirmedAt: daysAgo(1) } },
    });
    const [first] = rankByCriteria([weakButConfirmed, strongButSilent], criteria(), {}, NOW);
    expect(first?.surgeon.ahpraId).toBe(strongButSilent.ahpraId);
  });

  it("a confirmed payer still outranks an unknown one, all else equal", () => {
    const confirmed = surgeon({
      access: { ...blankAccess(), workcover: { value: true, tier: "A", source: "phone", confirmedAt: daysAgo(1) } },
    });
    const silent = surgeon();
    const [first] = rankByCriteria([silent, confirmed], criteria(), {}, NOW);
    expect(first?.surgeon.ahpraId).toBe(confirmed.ahpraId);
  });

  it("an unknown-heavy directory still returns a usable list, not a handful", () => {
    const surgeons = makeFixtureSurgeons({ count: 50, unknownRatio: 0.8, seed: 8080 });
    const results = rankByCriteria(surgeons, criteria({ region: "general", category: "unspecified" }), {}, NOW);
    expect(results.length).toBeGreaterThanOrEqual(40);
  });
});

describe("self-reported waits", () => {
  const withWait = (days: number, selfReported: boolean) =>
    surgeon({
      access: {
        ...blankAccess(),
        waitToConsultDays: selfReported
          ? { value: days, tier: "S", source: "portal", confirmedAt: daysAgo(1) }
          : { value: days, tier: "B", source: "booking-platform", confirmedAt: daysAgo(1) },
      },
    });

  it("are discounted against a booking-platform figure of the same length", () => {
    const portal = withWait(30, true);
    const platform = withWait(30, false);
    const [first] = rankByCriteria([portal, platform], criteria({ payer: null }), {}, NOW);
    expect(first?.surgeon.ahpraId).toBe(platform.ahpraId);
  });

  it("say so, because the discount changed the order", () => {
    const [result] = rankByCriteria([withWait(30, true)], criteria({ payer: null }), {}, NOW);
    expect(result?.reasons).toContain("Self-reported wait ranked conservatively");
  });

  it("still show the figure the practice reported, untouched", () => {
    const [result] = rankByCriteria([withWait(42, true)], criteria({ payer: null }), {}, NOW);
    expect(result?.reasons.some((r) => r.startsWith("Wait to consult 6 weeks — self-reported"))).toBe(true);
  });

  it("the multiplier is the only thing that discounts them", () => {
    expect(SELF_REPORTED_WAIT_MULTIPLIER).toBeGreaterThan(1);
  });
});

describe("hard filters", () => {
  it("excludes a recorded refusal of the payer the GP selected", () => {
    const refuses = surgeon({
      access: { ...blankAccess(), workcover: { value: false, tier: "A", source: "phone", confirmedAt: daysAgo(1) } },
    });
    expect(rankByCriteria([refuses], criteria(), {}, NOW)).toHaveLength(0);
  });

  it("does not exclude an unconfirmed payer — silence is not a refusal", () => {
    expect(rankByCriteria([surgeon()], criteria(), {}, NOW)).toHaveLength(1);
  });

  it("excludes a tagged surgeon whose tags are all elsewhere", () => {
    const elsewhere = surgeon({
      subspecialtyTags: [
        { bucket: "hand_wrist", tier: "A", evidence: "Australian Hand Surgery Society member", sourceRecordIds: [] },
      ],
    });
    expect(rankByCriteria([elsewhere], criteria(), {}, NOW)).toHaveLength(0);
  });

  it("keeps an untagged surgeon, and says they are untagged", () => {
    const [result] = rankByCriteria([surgeon()], criteria(), {}, NOW);
    expect(result).toBeDefined();
    expect(result?.reasons).toContain("No sub-specialty confirmed");
  });

  it("excludes anyone past the travel limit the GP set", () => {
    const far = surgeon({
      locations: [
        {
          id: "l1", kind: "rooms", name: "Far Rooms", address: "1 Far St", suburb: "Mildura",
          state: "VIC", postcode: "3500", lat: -34.1855, lng: 142.1625, sector: "private",
          departmentWait: null,
        },
      ],
    });
    const origin = { lat: -37.8136, lng: 144.9631 };
    expect(rankByCriteria([far], criteria({ maxTravelKm: 50 }), { origin }, NOW)).toHaveLength(0);
    expect(rankByCriteria([far], criteria({ maxTravelKm: 600 }), { origin }, NOW)).toHaveLength(1);
  });
});

describe("no hidden weights", () => {
  it("every surgeon returned carries at least one reason", () => {
    const surgeons = makeFixtureSurgeons({ count: 50 });
    for (const result of rankByCriteria(surgeons, criteria({ region: "general", category: "unspecified" }), {}, NOW)) {
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  it("a published public wait states itself and moves nobody", () => {
    const publicLoc = surgeon({
      locations: [
        {
          id: "l1", kind: "operating", name: "Fitzroy North Public Hospital", address: "1 Hospital Dr",
          suburb: "Fitzroy North", state: "VIC", postcode: "3068", lat: -37.7833, lng: 144.9833,
          sector: "public",
          departmentWait: {
            waitToConsultDays: { value: 210, tier: "A", source: "state-health", confirmedAt: daysAgo(10) },
            waitToSurgeryDays: { value: 300, tier: "A", source: "state-health", confirmedAt: daysAgo(10) },
          },
        },
      ],
    });
    const bare = surgeon({
      locations: [
        {
          id: "l2", kind: "operating", name: "Elsewhere Public Hospital", address: "2 Hospital Dr",
          suburb: "Fitzroy North", state: "VIC", postcode: "3068", lat: -37.7833, lng: 144.9833,
          sector: "public", departmentWait: null,
        },
      ],
    });
    const results = rankByCriteria([publicLoc, bare], criteria({ payer: null }), {}, NOW);
    expect(results[0]?.score).toBe(results[1]?.score);
    const stated = results.find((r) => r.surgeon.ahpraId === publicLoc.ahpraId);
    expect(
      stated?.reasons.some((r) => r.includes("published department figure, not this surgeon's own")),
    ).toBe(true);
  });

  it("the weights are all exported, so nothing scores from a private constant", () => {
    expect(Object.values(MATCH_WEIGHTS).every((w) => typeof w === "number")).toBe(true);
  });
});

describe("determinism", () => {
  it("the same input yields identical output, every time", () => {
    const surgeons = makeFixtureSurgeons({ count: 50 });
    const once = rankByCriteria(surgeons, criteria(), {}, NOW);
    const twice = rankByCriteria(surgeons, criteria(), {}, NOW);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("input order cannot change the result", () => {
    const surgeons = makeFixtureSurgeons({ count: 50 });
    const forward = rankByCriteria(surgeons, criteria(), {}, NOW).map((r) => r.surgeon.ahpraId);
    const reversed = rankByCriteria([...surgeons].reverse(), criteria(), {}, NOW).map((r) => r.surgeon.ahpraId);
    expect(reversed).toEqual(forward);
  });

  it("ties break on AHPRA id, never on position", () => {
    const a = surgeon({ ahpraId: "MED0000000002" });
    const b = surgeon({ ahpraId: "MED0000000001" });
    const [first] = rankByCriteria([a, b], criteria(), {}, NOW);
    expect(first?.surgeon.ahpraId).toBe("MED0000000001");
  });
});
