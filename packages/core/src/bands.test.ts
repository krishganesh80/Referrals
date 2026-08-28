import { describe, expect, it } from "vitest";
import { BAND_GAP_FLOOR, MAX_BANDS, bandedOrder, groupIntoBands } from "./bands";
import { rankByCriteria, type Criteria, type RankedResult } from "./matcher";
import { makeFixtureSurgeons, FIXTURE_POSTCODE_CENTROIDS } from "./fixtures";
import type { Surgeon } from "./schema";

const NOW = new Date("2026-08-28T00:00:00.000Z");

const fake = (score: number, familyName: string, ahpraId: string): RankedResult => ({
  surgeon: { familyName, givenNames: "Sample", ahpraId } as Surgeon,
  score,
  reasons: [],
  nearestLocation: null,
  distanceKm: null,
});

describe("grouping", () => {
  it("returns nothing for no results", () => {
    expect(groupIntoBands([])).toEqual([]);
  });

  it("keeps scores that barely differ in one group", () => {
    const bands = groupIntoBands([fake(70.4, "B", "MED2"), fake(70.1, "A", "MED1"), fake(69.9, "C", "MED3")]);
    expect(bands).toHaveLength(1);
    expect(bands[0]?.label).toBe("Matched your criteria");
  });

  it("splits where the gap is genuinely large", () => {
    const bands = groupIntoBands([fake(80, "B", "MED2"), fake(78, "A", "MED1"), fake(40, "C", "MED3")]);
    expect(bands).toHaveLength(2);
    expect(bands[0]?.results.map((r) => r.surgeon.ahpraId)).toEqual(["MED1", "MED2"]);
    expect(bands[1]?.results.map((r) => r.surgeon.ahpraId)).toEqual(["MED3"]);
  });

  it("never produces more than three groups, however jagged the scores", () => {
    const jagged = [100, 80, 60, 40, 20, 5].map((s, i) => fake(s, `N${i}`, `MED${i}`));
    expect(groupIntoBands(jagged).length).toBeLessThanOrEqual(MAX_BANDS);
  });

  it("splits at the widest gaps, not the first ones it meets", () => {
    const scores = [100, 96, 92, 50, 46, 10].map((s, i) => fake(s, `N${i}`, `MED${i}`));
    const bands = groupIntoBands(scores);
    expect(bands).toHaveLength(3);
    expect(bands[0]?.results).toHaveLength(3);
    expect(bands[1]?.results).toHaveLength(2);
    expect(bands[2]?.results).toHaveLength(1);
  });

  it("ignores a gap below the floor even when it is a large fraction of a small top score", () => {
    const bands = groupIntoBands([fake(4, "A", "MED1"), fake(2.2, "B", "MED2")]);
    expect(bands).toHaveLength(1);
    expect(BAND_GAP_FLOOR).toBe(2.5);
  });
});

describe("order inside a group is visibly arbitrary", () => {
  it("is alphabetical by family name, not by score", () => {
    const bands = groupIntoBands([fake(70.4, "Zephyrhill", "MED3"), fake(70.2, "Aldergrove", "MED1"), fake(70.0, "Marchbanks", "MED2")]);
    expect(bands[0]?.results.map((r) => r.surgeon.familyName)).toEqual(["Aldergrove", "Marchbanks", "Zephyrhill"]);
  });

  it("the top-scoring record does not necessarily appear first", () => {
    const bands = groupIntoBands([fake(70.4, "Zephyrhill", "MED3"), fake(70.2, "Aldergrove", "MED1")]);
    expect(bands[0]?.results[0]?.surgeon.familyName).toBe("Aldergrove");
    expect(bands[0]?.results[0]?.score).toBeLessThan(bands[0]!.results[1]!.score);
  });

  it("breaks a shared family name on given names, then on the canonical key", () => {
    const bands = groupIntoBands([
      { ...fake(70, "Smith", "MED2"), surgeon: { familyName: "Smith", givenNames: "Bea", ahpraId: "MED2" } as Surgeon },
      { ...fake(70, "Smith", "MED1"), surgeon: { familyName: "Smith", givenNames: "Ann", ahpraId: "MED1" } as Surgeon },
    ]);
    expect(bands[0]?.results.map((r) => r.surgeon.givenNames)).toEqual(["Ann", "Bea"]);
  });
});

describe("the real separation stays visible", () => {
  const criteria: Criteria = {
    region: "knee", category: "sports_soft_tissue", payer: "workcover",
    postcode: "3000", maxTravelKm: 25, sector: "either", fund: null,
  };
  const surgeons = makeFixtureSurgeons({ count: 50 });
  const origin = FIXTURE_POSTCODE_CENTROIDS["3000"]!;
  const results = rankByCriteria(surgeons, criteria, { origin }, NOW);

  it("a genuinely weaker match does not end up in the top group", () => {
    const bands = groupIntoBands(results);
    if (bands.length > 1) {
      const topLow = Math.min(...bands[0]!.results.map((r) => r.score));
      const nextHigh = Math.max(...bands[1]!.results.map((r) => r.score));
      expect(topLow).toBeGreaterThan(nextHigh);
    }
  });

  it("every result survives grouping — nothing is dropped or duplicated", () => {
    const flat = bandedOrder(groupIntoBands(results));
    expect(flat).toHaveLength(results.length);
    expect(new Set(flat.map((r) => r.surgeon.ahpraId)).size).toBe(results.length);
  });

  it("works on the launch-shaped directory, where most scores cluster", () => {
    const unknownHeavy = rankByCriteria(makeFixtureSurgeons({ count: 50, unknownRatio: 0.8, seed: 8080 }), criteria, { origin }, NOW);
    const bands = groupIntoBands(unknownHeavy);
    expect(bands.length).toBeGreaterThan(0);
    expect(bandedOrder(bands)).toHaveLength(unknownHeavy.length);
  });
});

describe("determinism", () => {
  const criteria: Criteria = {
    region: "general", category: "unspecified", payer: null,
    postcode: "3000", maxTravelKm: 150, sector: "either", fund: null,
  };
  const surgeons = makeFixtureSurgeons({ count: 50 });

  it("the same results always group the same way", () => {
    const results = rankByCriteria(surgeons, criteria, {}, NOW);
    expect(JSON.stringify(groupIntoBands(results))).toBe(JSON.stringify(groupIntoBands(results)));
  });

  it("input order cannot change the grouping", () => {
    const forward = bandedOrder(groupIntoBands(rankByCriteria(surgeons, criteria, {}, NOW)));
    const reversed = bandedOrder(groupIntoBands(rankByCriteria([...surgeons].reverse(), criteria, {}, NOW)));
    expect(reversed.map((r) => r.surgeon.ahpraId)).toEqual(forward.map((r) => r.surgeon.ahpraId));
  });

  it("grouping is presentation — it never touches the scores themselves", () => {
    const results = rankByCriteria(surgeons, criteria, {}, NOW);
    const byId = new Map(bandedOrder(groupIntoBands(results)).map((r) => [r.surgeon.ahpraId, r.score]));
    for (const result of results) expect(byId.get(result.surgeon.ahpraId)).toBe(result.score);
  });
});
