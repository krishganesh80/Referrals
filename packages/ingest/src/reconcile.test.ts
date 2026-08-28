import { describe, expect, it } from "vitest";
import { makeFixtureSurgeons } from "@referral/core";
import type { Surgeon } from "@referral/core";
import { fuzzyCandidates, normaliseName, reconcile } from "./reconcile";
import type { IncomingRecord } from "./runner";
import type { PartialSurgeon } from "./types";

const TODAY = "2026-08-28";

const partial = (over: Partial<PartialSurgeon> = {}): PartialSurgeon => ({
  ahpraId: "MED1000000000",
  familyName: "Aldergrove",
  givenNames: "Alice",
  postcodeHint: "3144",
  specialistRegistrationSince: "2003-06-08",
  tags: [],
  locations: [],
  languages: ["English"],
  telehealth: null,
  ...over,
});

const incoming = (
  over: Partial<PartialSurgeon> = {},
  tier: IncomingRecord["tier"] = "A",
  adapterId = "society-knee",
): IncomingRecord => ({
  adapterId,
  tier,
  sourceRecord: {
    id: `${adapterId}:abc123`,
    adapterId,
    fetchedAt: "2026-08-28T00:00:00.000Z",
    url: "https://society.test/find",
    snapshotHash: "abc123",
  },
  partial: partial(over),
});

const existing = (): Surgeon[] => makeFixtureSurgeons({ count: 3 });

describe("matching", () => {
  it("merges on an exact AHPRA id", () => {
    const held = existing();
    const result = reconcile(held, [incoming({ ahpraId: held[0]!.ahpraId, tags: [{ bucket: "spine", evidence: "Spine Society of Australia member" }] })], { today: TODAY });
    expect(result.surgeons).toHaveLength(3);
    const merged = result.surgeons.find((s) => s.ahpraId === held[0]!.ahpraId)!;
    expect(merged.subspecialtyTags.some((t) => t.bucket === "spine" && t.tier === "A")).toBe(true);
  });

  it("creates a record for an AHPRA id we have never seen", () => {
    const result = reconcile(existing(), [incoming({ ahpraId: "MED9999999999" })], { today: TODAY });
    expect(result.surgeons).toHaveLength(4);
    const created = result.surgeons.find((s) => s.ahpraId === "MED9999999999")!;
    // Identity sources say who somebody is, never who they accept.
    expect(Object.values(created.access).every((f) => f.value === "unknown")).toBe(true);
    expect(created.referralWeight).toBe(0);
  });

  it("never auto-merges a record with no AHPRA id, however close the resemblance", () => {
    const held = existing();
    const twin = {
      ahpraId: null,
      familyName: held[0]!.familyName,
      givenNames: held[0]!.givenNames,
      postcodeHint: held[0]!.locations[0]!.postcode,
    };
    const result = reconcile(held, [incoming(twin)], { today: TODAY });
    expect(result.surgeons).toHaveLength(3);
    expect(result.surgeons[0]!.sourceRecords).toEqual(held.find((s) => s.ahpraId === result.surgeons[0]!.ahpraId)!.sourceRecords);
    const item = result.review.find((r) => r.kind === "fuzzy-match");
    expect(item).toBeDefined();
    expect(item && item.kind === "fuzzy-match" && item.candidateAhpraId).toBe(held[0]!.ahpraId);
  });

  it("files an unrecognisable record as unidentified rather than dropping it", () => {
    const result = reconcile(existing(), [incoming({ ahpraId: null, familyName: "Nobodyhere", givenNames: "Zeta", postcodeHint: "9999" })], { today: TODAY });
    expect(result.review.filter((r) => r.kind === "unidentified")).toHaveLength(1);
  });

  it("says why a fuzzy candidate was proposed", () => {
    const held = existing();
    const result = reconcile(held, [incoming({ ahpraId: null, familyName: held[0]!.familyName, givenNames: "Zoltan", postcodeHint: held[0]!.locations[0]!.postcode })], { today: TODAY });
    const item = result.review.find((r) => r.kind === "fuzzy-match");
    expect(item && item.kind === "fuzzy-match" && item.basis).toContain("family name matches");
    expect(item && item.kind === "fuzzy-match" && item.basis).toContain("postcode");
  });
});

describe("conflicts", () => {
  it("keeps the held value and files the disagreement — nothing is discarded", () => {
    const held = existing();
    const result = reconcile(held, [incoming({ ahpraId: held[0]!.ahpraId, givenNames: "Alicia" })], { today: TODAY });
    const merged = result.surgeons.find((s) => s.ahpraId === held[0]!.ahpraId)!;
    expect(merged.givenNames).toBe(held[0]!.givenNames);
    const conflict = result.review.find((r) => r.kind === "conflict");
    expect(conflict && conflict.kind === "conflict" && conflict.conflict).toMatchObject({
      field: "givenNames",
      held: held[0]!.givenNames,
      incoming: "Alicia",
      adapterId: "society-knee",
    });
  });

  it("does not raise a conflict for a field the source did not report", () => {
    const held = existing();
    const result = reconcile(held, [incoming({ ahpraId: held[0]!.ahpraId, telehealth: null, specialistRegistrationSince: null })], { today: TODAY });
    const fields = result.review.filter((r) => r.kind === "conflict").map((r) => r.kind === "conflict" && r.conflict.field);
    expect(fields).not.toContain("telehealth");
    expect(fields).not.toContain("specialistRegistrationSince");
  });
});

describe("tier C never auto-promotes", () => {
  it("a practice-website tag becomes a candidate, not a fact on the record", () => {
    // Built from a tier A source so the starting record is known exactly — reconciling against
    // the fixture set would leave the assertion depending on what the fixture happened to hold.
    const seeded = reconcile(
      [],
      [incoming({ ahpraId: "MED9999999999", tags: [{ bucket: "spine", evidence: "Spine Society of Australia member" }] })],
      { today: TODAY },
    ).surgeons;

    const result = reconcile(
      seeded,
      [incoming({ ahpraId: "MED9999999999", tags: [{ bucket: "tumour", evidence: "Listed on practice website" }] }, "C", "practice-site-x")],
      { today: TODAY },
    );

    const merged = result.surgeons[0]!;
    expect(merged.subspecialtyTags.map((t) => t.bucket)).toEqual(["spine"]);
    expect(merged.subspecialtyTags.every((t) => t.tier !== "C")).toBe(true);
    const candidate = result.review.find((r) => r.kind === "tag-candidate");
    expect(candidate && candidate.kind === "tag-candidate" && candidate.tag.bucket).toBe("tumour");
    expect(candidate && candidate.kind === "tag-candidate" && candidate.tag.tier).toBe("C");
  });

  it("holds even for a brand-new record built entirely from a tier C source", () => {
    const result = reconcile(
      [],
      [incoming({ ahpraId: "MED9999999999", tags: [{ bucket: "spine", evidence: "Listed on practice website" }] }, "C", "practice-site-x")],
      { today: TODAY },
    );
    expect(result.surgeons[0]!.subspecialtyTags).toEqual([]);
    expect(result.review.filter((r) => r.kind === "tag-candidate")).toHaveLength(1);
  });

  it("a tier A tag does go straight on", () => {
    const result = reconcile([], [incoming({ ahpraId: "MED9999999999", tags: [{ bucket: "spine", evidence: "Spine Society of Australia member" }] })], { today: TODAY });
    expect(result.surgeons[0]!.subspecialtyTags).toHaveLength(1);
  });
});

describe("tag merging", () => {
  it("stronger evidence takes the bucket, and the weaker source is still credited", () => {
    const first = reconcile([], [incoming({ ahpraId: "MED9999999999", tags: [{ bucket: "spine", evidence: "11 spine publications indexed" }] }, "B", "pubmed")], { today: TODAY });
    const second = reconcile(first.surgeons, [incoming({ ahpraId: "MED9999999999", tags: [{ bucket: "spine", evidence: "Spine Society of Australia member" }] }, "A", "society-spine")], { today: TODAY });
    const tag = second.surgeons[0]!.subspecialtyTags.find((t) => t.bucket === "spine")!;
    expect(tag.tier).toBe("A");
    expect(tag.sourceRecordIds).toContain("pubmed:abc123");
    expect(tag.sourceRecordIds).toContain("society-spine:abc123");
  });

  it("weaker evidence does not displace stronger", () => {
    const first = reconcile([], [incoming({ ahpraId: "MED9999999999", tags: [{ bucket: "spine", evidence: "Spine Society of Australia member" }] }, "A", "society-spine")], { today: TODAY });
    const second = reconcile(first.surgeons, [incoming({ ahpraId: "MED9999999999", tags: [{ bucket: "spine", evidence: "11 spine publications indexed" }] }, "B", "pubmed")], { today: TODAY });
    expect(second.surgeons[0]!.subspecialtyTags.find((t) => t.bucket === "spine")!.tier).toBe("A");
  });
});

describe("determinism", () => {
  it("output order is by AHPRA id, never by arrival", () => {
    const records = [incoming({ ahpraId: "MED9999999999" }), incoming({ ahpraId: "MED1111111111" })];
    const forward = reconcile([], records, { today: TODAY }).surgeons.map((s) => s.ahpraId);
    const reversed = reconcile([], [...records].reverse(), { today: TODAY }).surgeons.map((s) => s.ahpraId);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(["MED1111111111", "MED9999999999"]);
  });
});

describe("name normalisation", () => {
  it("folds case, punctuation and diacritics", () => {
    expect(normaliseName("O'Brien-Smith")).toBe(normaliseName("obriensmith"));
    expect(normaliseName("Müller")).toBe("muller");
  });

  it("does not collapse two genuinely different names", () => {
    expect(normaliseName("Anderson")).not.toBe(normaliseName("Andersen"));
  });

  it("proposes no candidate when only the surname matches", () => {
    const held = existing();
    expect(
      fuzzyCandidates(partial({ ahpraId: null, familyName: held[0]!.familyName, givenNames: "Zoltan", postcodeHint: "9999" }), held),
    ).toHaveLength(0);
  });
});
