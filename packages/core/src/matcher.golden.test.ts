// The regression net for the whole product.
//
// Two golden sets over the same twenty criteria. The first is the directory as we hope it looks
// once verification has run; the second is what launch actually looks like — 80% of access
// fields unconfirmed — and it is tested as the NORMAL case, not as an edge.
//
// The goldens record exact ordering AND the exact reason strings, because the reasons are what
// the GP reads. A wording change is a product change and has to be seen in a diff.

import { describe, expect, it } from "vitest";
import { rankByCriteria, type Criteria } from "./matcher";
import { FIXTURE_POSTCODE_CENTROIDS, makeFixtureSurgeons } from "./fixtures";
import { displayName } from "./schema";

const NOW = new Date("2026-08-28T00:00:00.000Z");

/** Twenty criteria sets, chosen to walk the taxonomy, the payers, both sectors and the funds. */
export const GOLDEN_CRITERIA: ReadonlyArray<{ name: string; criteria: Criteria }> = [
  { name: "01-knee-sports-workcover-cbd", criteria: { region: "knee", category: "sports_soft_tissue", payer: "workcover", postcode: "3000", maxTravelKm: 25, sector: "either", fund: null } },
  { name: "02-knee-arthroplasty-any-payer", criteria: { region: "knee", category: "joint_replacement", payer: null, postcode: "3000", maxTravelKm: 25, sector: "either", fund: null } },
  { name: "03-hip-arthroplasty-dva-private", criteria: { region: "hip", category: "joint_replacement", payer: "dva", postcode: "3144", maxTravelKm: 30, sector: "private", fund: null } },
  { name: "04-shoulder-sports-tac", criteria: { region: "shoulder", category: "sports_soft_tissue", payer: "tac", postcode: "3121", maxTravelKm: 40, sector: "either", fund: null } },
  { name: "05-hand-nerve-compression-comcare", criteria: { region: "wrist_hand", category: "nerve_compression", payer: "comcare", postcode: "3000", maxTravelKm: 50, sector: "either", fund: null } },
  { name: "06-foot-ankle-deformity-hcf", criteria: { region: "foot_ankle", category: "deformity_reconstruction", payer: null, postcode: "3144", maxTravelKm: 30, sector: "private", fund: "HCF" } },
  { name: "07-spine-nerve-compression-public", criteria: { region: "spine", category: "nerve_compression", payer: null, postcode: "3068", maxTravelKm: 40, sector: "public", fund: null } },
  { name: "08-spine-trauma-ctp", criteria: { region: "spine", category: "trauma_fracture", payer: "ctp", postcode: "3000", maxTravelKm: 60, sector: "either", fund: null } },
  { name: "09-paediatric-knee", criteria: { region: "knee", category: "paediatric", payer: null, postcode: "3000", maxTravelKm: 60, sector: "either", fund: null } },
  { name: "10-tumour-any-region", criteria: { region: "general", category: "tumour", payer: null, postcode: "3000", maxTravelKm: 100, sector: "either", fund: null } },
  { name: "11-elbow-nerve-compression", criteria: { region: "elbow", category: "nerve_compression", payer: null, postcode: "3121", maxTravelKm: 35, sector: "either", fund: null } },
  { name: "12-pelvis-trauma", criteria: { region: "pelvis", category: "trauma_fracture", payer: "tac", postcode: "3000", maxTravelKm: 80, sector: "either", fund: null } },
  { name: "13-general-unspecified-wide", criteria: { region: "general", category: "unspecified", payer: null, postcode: "3000", maxTravelKm: 150, sector: "either", fund: null } },
  { name: "14-general-unspecified-tight-radius", criteria: { region: "general", category: "unspecified", payer: null, postcode: "3144", maxTravelKm: 8, sector: "either", fund: null } },
  { name: "15-knee-sports-medibank-private", criteria: { region: "knee", category: "sports_soft_tissue", payer: null, postcode: "3128", maxTravelKm: 30, sector: "private", fund: "Medibank" } },
  { name: "16-hip-trauma-public", criteria: { region: "hip", category: "trauma_fracture", payer: null, postcode: "3030", maxTravelKm: 60, sector: "public", fund: null } },
  { name: "17-shoulder-arthroplasty-bupa", criteria: { region: "shoulder", category: "joint_replacement", payer: null, postcode: "3000", maxTravelKm: 40, sector: "either", fund: "Bupa" } },
  { name: "18-foot-ankle-workcover-far", criteria: { region: "foot_ankle", category: "sports_soft_tissue", payer: "workcover", postcode: "3806", maxTravelKm: 60, sector: "either", fund: null } },
  { name: "19-hand-trauma-nib", criteria: { region: "wrist_hand", category: "trauma_fracture", payer: null, postcode: "3083", maxTravelKm: 45, sector: "either", fund: "NIB" } },
  { name: "20-unknown-postcode-no-distance", criteria: { region: "knee", category: "sports_soft_tissue", payer: null, postcode: "9999", maxTravelKm: 25, sector: "either", fund: null } },
];

function render(criteria: Criteria, surgeons: ReturnType<typeof makeFixtureSurgeons>): string {
  const origin = FIXTURE_POSTCODE_CENTROIDS[criteria.postcode];
  const results = rankByCriteria(surgeons, criteria, origin ? { origin } : {}, NOW);
  const lines: string[] = [
    `criteria: ${JSON.stringify(criteria)}`,
    `origin:   ${origin ? `${origin.lat}, ${origin.lng}` : "not in gazetteer — distance not ranked"}`,
    `results:  ${results.length} of ${surgeons.length}`,
    "",
  ];
  results.forEach((result, index) => {
    lines.push(
      `${String(index + 1).padStart(2, " ")}. ${displayName(result.surgeon)}  [${result.surgeon.ahpraId}]  score ${result.score.toFixed(3)}`,
    );
    for (const reason of result.reasons) lines.push(`      - ${reason}`);
  });
  return `${lines.join("\n")}\n`;
}

describe("golden — the verified-directory shape", () => {
  const surgeons = makeFixtureSurgeons({ count: 50 });

  it.each(GOLDEN_CRITERIA)("$name", async ({ name, criteria }) => {
    await expect(render(criteria, surgeons)).toMatchFileSnapshot(`./__golden__/verified-${name}.txt`);
  });
});

describe("golden — the launch shape, 80% of access fields unconfirmed", () => {
  const surgeons = makeFixtureSurgeons({ count: 50, unknownRatio: 0.8, seed: 8080 });

  it.each(GOLDEN_CRITERIA)("$name", async ({ name, criteria }) => {
    await expect(render(criteria, surgeons)).toMatchFileSnapshot(`./__golden__/unknown-heavy-${name}.txt`);
  });

  it("is genuinely unknown-heavy — the fixture would not otherwise be testing anything", () => {
    let unknown = 0;
    let total = 0;
    for (const s of surgeons) {
      for (const field of Object.values(s.access)) {
        total += 1;
        if (field.value === "unknown") unknown += 1;
      }
    }
    expect(unknown / total).toBeGreaterThan(0.7);
  });

  it("still returns a usable list for every one of the twenty criteria sets", () => {
    // Not one of the twenty comes back empty at 80% unknown, including the 8 km radius and the
    // narrowest buckets. That is the whole claim: the product is usable before verification has
    // run. If a future change empties any of these, this fails before the goldens do.
    for (const { name, criteria } of GOLDEN_CRITERIA) {
      const origin = FIXTURE_POSTCODE_CENTROIDS[criteria.postcode];
      const results = rankByCriteria(surgeons, criteria, origin ? { origin } : {}, NOW);
      expect(results.length, name).toBeGreaterThan(0);
    }
  });
});
