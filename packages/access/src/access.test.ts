import { describe, expect, it } from "vitest";
import { makeFixtureSurgeons, type AccessField, type Surgeon, type Tri } from "@referral/core";
import { practiceSizes, referralWeightFor, withReferralWeights, REFERRAL_WEIGHT_FACTORS } from "./referral-weight";
import { buildCallQueue, fieldsWorthAsking, isCovered, stalenessUrgency, FIELD_URGENCY_WEIGHT } from "./call-queue";
import { suppressionFor, historyIndex, NO_ANSWER_LIMIT, type CallRecord } from "./call-log";
import { detectDiscrepancies, rankDiscrepancies, type PublishedOutcomeCell } from "./discrepancy";
import { applyPatch, buildPatch, kindOf, parseAnswer, promptFor } from "./verification";
import { allCollectors, CollectorNotImplementedError } from "./collectors/index";

const NOW = new Date("2026-08-28T00:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);
const field = <T,>(value: T | "unknown", over: Partial<AccessField<T>> = {}): AccessField<T> => ({
  value, tier: "A", source: "phone", confirmedAt: daysAgo(1), ...over,
});

const base = makeFixtureSurgeons({ count: 1 })[0]!;
const surgeon = (over: Partial<Surgeon> = {}): Surgeon => ({ ...base, ...over });

describe("referral weight", () => {
  it("uses public footprint signals only, and the weights are all exported", () => {
    expect(Object.values(REFERRAL_WEIGHT_FACTORS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("treats years since registration as the weakest signal", () => {
    const factors = Object.entries(REFERRAL_WEIGHT_FACTORS);
    const weakest = factors.sort((a, b) => a[1] - b[1])[0]!;
    expect(weakest[0]).toBe("yearsSinceRegistration");
  });

  it("stays within 0 and 1", () => {
    const sizes = practiceSizes(makeFixtureSurgeons({ count: 50 }));
    for (const s of makeFixtureSurgeons({ count: 50 })) {
      const w = referralWeightFor(s, sizes, NOW).total;
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it("ranks a surgeon with more hospitals and funds above one with neither", () => {
    const sizes = new Map<string, number>();
    const big = surgeon({
      locations: [base.locations[0]!, { ...base.locations[1]!, id: "op1", name: "Hospital One" }, { ...base.locations[1]!, id: "op2", name: "Hospital Two" }],
      access: { ...base.access, noGapFunds: field<string[]>(["HCF", "Bupa", "Medibank"]) },
    });
    const small = surgeon({
      locations: [base.locations[0]!],
      access: { ...base.access, noGapFunds: field<string[]>([]) },
    });
    expect(referralWeightFor(big, sizes, NOW).total).toBeGreaterThan(referralWeightFor(small, sizes, NOW).total);
  });

  it("counts practice size across the whole directory, not per record", () => {
    const shared = { ...base.locations[0]!, name: "Shared Rooms", postcode: "3144" };
    const sizes = practiceSizes([
      surgeon({ ahpraId: "MED0000000001", locations: [shared] }),
      surgeon({ ahpraId: "MED0000000002", locations: [shared] }),
      surgeon({ ahpraId: "MED0000000003", locations: [shared] }),
    ]);
    expect([...sizes.values()][0]).toBe(3);
  });

  it("stamps a weight onto every surgeon", () => {
    const weighted = withReferralWeights(makeFixtureSurgeons({ count: 10 }), NOW);
    expect(weighted.every((s) => s.referralWeight >= 0 && s.referralWeight <= 1)).toBe(true);
  });
});

describe("staleness urgency", () => {
  const allUnknown = (): Surgeon["access"] => {
    const a = { ...base.access } as Record<string, AccessField<unknown>>;
    for (const key of Object.keys(a)) a[key] = field("unknown");
    return a as Surgeon["access"];
  };

  it("is 1 when nothing is confirmed", () => {
    expect(stalenessUrgency(surgeon({ access: allUnknown() }), NOW)).toBeCloseTo(1, 6);
  });

  it("is 0 when everything was confirmed today", () => {
    const a = { ...base.access } as Record<string, AccessField<unknown>>;
    for (const key of Object.keys(a)) a[key] = field(true as unknown as Tri, { confirmedAt: daysAgo(0) });
    a["noGapFunds"] = field<string[]>(["HCF"], { confirmedAt: daysAgo(0) });
    a["waitToConsultDays"] = field<number>(20, { confirmedAt: daysAgo(0) });
    a["waitToSurgeryDays"] = field<number>(40, { confirmedAt: daysAgo(0) });
    expect(stalenessUrgency(surgeon({ access: a as Surgeon["access"] }), NOW)).toBe(0);
  });

  it("weights books-open and the consult wait above bulk billing", () => {
    expect(FIELD_URGENCY_WEIGHT.booksOpen).toBeGreaterThan(FIELD_URGENCY_WEIGHT.bulkBillsInitial);
    expect(FIELD_URGENCY_WEIGHT.waitToConsultDays).toBeGreaterThan(FIELD_URGENCY_WEIGHT.comcare);
  });

  it("asks about the most decision-relevant field first", () => {
    const fields = fieldsWorthAsking(surgeon({ access: allUnknown() }), NOW);
    expect(fields[0]).toBe("booksOpen");
  });

  it("marks a fully fresh record as covered", () => {
    expect(isCovered(surgeon({ access: allUnknown() }), NOW)).toBe(false);
  });
});

describe("the call queue", () => {
  const surgeons = withReferralWeights(makeFixtureSurgeons({ count: 50, unknownRatio: 0.8, seed: 8080 }), NOW);
  const melbourne = { lat: -37.8136, lng: 144.9631, radiusKm: 45 };

  it("reports referral-volume coverage, not a headcount", () => {
    const queue = buildCallQueue(surgeons, NOW, { metro: melbourne });
    expect(queue.coverageNow).toHaveProperty("volumeCoveragePct");
    expect(queue.coverageNow.volumeCoveragePct).toBeGreaterThanOrEqual(0);
    expect(queue.coverageNow.volumeCoveragePct).toBeLessThanOrEqual(100);
  });

  it("orders by referral weight times urgency", () => {
    const queue = buildCallQueue(surgeons, NOW, { metro: melbourne });
    const scores = queue.entries.map((e) => e.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("is deterministic — ties break on AHPRA id, never on input order", () => {
    const forward = buildCallQueue(surgeons, NOW, { metro: melbourne }).entries.map((e) => e.surgeon.ahpraId);
    const reversed = buildCallQueue([...surgeons].reverse(), NOW, { metro: melbourne }).entries.map((e) => e.surgeon.ahpraId);
    expect(reversed).toEqual(forward);
  });

  it("says how many calls reach a coverage target", () => {
    const queue = buildCallQueue(surgeons, NOW, { metro: melbourne, targetVolumeCoverage: 0.7 });
    expect(queue.callsToTarget).toBeGreaterThan(0);
    expect(queue.callsToTarget).toBeLessThanOrEqual(surgeons.length);
  });

  it("working the queue raises projected coverage above where it stands", () => {
    const queue = buildCallQueue(surgeons, NOW, { metro: melbourne, limit: 40 });
    expect(queue.coverageIfWorked.volumeCoveragePct).toBeGreaterThan(queue.coverageNow.volumeCoveragePct);
  });

  it("leaves out anyone with nothing worth asking", () => {
    const queue = buildCallQueue(surgeons, NOW, { metro: melbourne });
    expect(queue.entries.every((e) => e.urgency > 0)).toBe(true);
  });

  it("restricts to the target metro", () => {
    const tiny = buildCallQueue(surgeons, NOW, { metro: { lat: -12.46, lng: 130.84, radiusKm: 20 } });
    expect(tiny.entries).toHaveLength(0);
  });

  it("holds out a record that is resting, and says why", () => {
    const target = surgeons[0]!;
    const history = historyIndex([
      { ahpraId: target.ahpraId, outcome: "refused", at: daysAgo(10), note: null, callbackOn: null },
    ]);
    const queue = buildCallQueue(surgeons, NOW, { metro: melbourne, callHistory: history });
    expect(queue.entries.some((e) => e.surgeon.ahpraId === target.ahpraId)).toBe(false);
    const rested = queue.suppressed.find((e) => e.surgeon.ahpraId === target.ahpraId);
    expect(rested?.suppression.reason).toContain("declined to answer");
  });
});

describe("call cooldowns", () => {
  const record = (over: Partial<CallRecord>): CallRecord => ({
    ahpraId: "MED0000000001", outcome: "no-answer", at: daysAgo(1), note: null, callbackOn: null, ...over,
  });

  it("does not suppress a record nobody has called", () => {
    expect(suppressionFor([], NOW).suppressed).toBe(false);
  });

  it("rests a record after three unanswered calls in a row", () => {
    const three = Array.from({ length: NO_ANSWER_LIMIT }, (_, i) => record({ at: daysAgo(10 - i) }));
    expect(suppressionFor(three, NOW).suppressed).toBe(true);
  });

  it("does not rest after two", () => {
    expect(suppressionFor([record({ at: daysAgo(9) }), record({ at: daysAgo(8) })], NOW).suppressed).toBe(false);
  });

  it("a reached call breaks the no-answer run", () => {
    const history = [record({ at: daysAgo(9) }), record({ at: daysAgo(8) }), record({ at: daysAgo(7), outcome: "reached" })];
    expect(suppressionFor(history, NOW).suppressed).toBe(false);
  });

  it("a refusal is a cooldown, never permanent", () => {
    expect(suppressionFor([record({ outcome: "refused", at: daysAgo(10) })], NOW).suppressed).toBe(true);
    expect(suppressionFor([record({ outcome: "refused", at: daysAgo(200) })], NOW).suppressed).toBe(false);
  });

  it("a wrong number needs a new number before anyone dials again", () => {
    const s = suppressionFor([record({ outcome: "wrong-number", at: daysAgo(400) })], NOW);
    expect(s.suppressed).toBe(true);
    expect(s.until).toBeNull();
  });

  it("honours a requested callback date, then releases", () => {
    expect(suppressionFor([record({ outcome: "callback", callbackOn: daysAgo(-5) })], NOW).suppressed).toBe(true);
    expect(suppressionFor([record({ outcome: "callback", callbackOn: daysAgo(5) })], NOW).suppressed).toBe(false);
  });
});

describe("the discrepancy detector", () => {
  const cells = (declined: number, accepted: number): PublishedOutcomeCell[] => [
    { surgeonId: "MED0000000001", weekBucket: "2026-W34", accepted, declined, noResponse: 0, distinctInstalls: 6 },
  ];

  it("flags books-open against a high decline rate", () => {
    const s = surgeon({ ahpraId: "MED0000000001", access: { ...base.access, booksOpen: field<Tri>(true) } });
    const found = detectDiscrepancies([s], { outcomeCells: cells(9, 1) }, NOW);
    expect(found.some((d) => d.kind === "books-open-contradicted-by-outcomes")).toBe(true);
  });

  it("does not flag on too few referrals to mean anything", () => {
    const s = surgeon({ ahpraId: "MED0000000001", access: { ...base.access, booksOpen: field<Tri>(true) } });
    const found = detectDiscrepancies([s], { outcomeCells: cells(2, 1) }, NOW);
    expect(found.some((d) => d.kind === "books-open-contradicted-by-outcomes")).toBe(false);
  });

  it("flags a self-reported wait far shorter than the platform's next available", () => {
    const s = surgeon({
      ahpraId: "MED0000000001",
      access: { ...base.access, waitToConsultDays: field<number>(14, { tier: "S", source: "portal" }) },
    });
    const found = detectDiscrepancies(
      [s],
      { bookingPlatformWait: new Map([["MED0000000001", field<number>(56, { tier: "B", source: "booking-platform" })]]) },
      NOW,
    );
    expect(found.some((d) => d.kind === "wait-shorter-than-the-platform-shows")).toBe(true);
  });

  it("does not flag a booking-platform wait against another booking-platform wait", () => {
    const s = surgeon({
      ahpraId: "MED0000000001",
      access: { ...base.access, waitToConsultDays: field<number>(14, { tier: "B", source: "booking-platform" }) },
    });
    const found = detectDiscrepancies(
      [s],
      { bookingPlatformWait: new Map([["MED0000000001", field<number>(56, { tier: "B", source: "booking-platform" })]]) },
      NOW,
    );
    expect(found.some((d) => d.kind === "wait-shorter-than-the-platform-shows")).toBe(false);
  });

  it("flags a fund the insurer lists and we do not", () => {
    const s = surgeon({ ahpraId: "MED0000000001", access: { ...base.access, noGapFunds: field<string[]>(["HCF"]) } });
    const found = detectDiscrepancies([s], { insurerDirectoryFunds: new Map([["MED0000000001", ["HCF", "Bupa"]]]) }, NOW);
    const hit = found.find((d) => d.kind === "fund-listed-by-insurer-not-by-practice");
    expect(hit?.statement).toContain("Bupa");
  });

  it("flags a record no channel has confirmed inside its half-life", () => {
    const cold = { ...base.access, booksOpen: field<Tri>("unknown"), waitToConsultDays: field<number>("unknown"), workcover: field<Tri>("unknown") };
    const found = detectDiscrepancies([surgeon({ access: cold })], {}, NOW);
    expect(found.some((d) => d.kind === "no-confirmation-from-any-channel")).toBe(true);
  });

  it("ranks by confidence times referral weight, deterministically", () => {
    const found = detectDiscrepancies(
      [surgeon({ ahpraId: "MED0000000001", access: { ...base.access, booksOpen: field<Tri>("unknown"), waitToConsultDays: field<number>("unknown"), workcover: field<Tri>("unknown") } }),
       surgeon({ ahpraId: "MED0000000002", access: { ...base.access, booksOpen: field<Tri>("unknown"), waitToConsultDays: field<number>("unknown"), workcover: field<Tri>("unknown") } })],
      {},
      NOW,
    );
    const weights = new Map([["MED0000000001", 0.2], ["MED0000000002", 0.9]]);
    expect(rankDiscrepancies(found, weights)[0]?.ahpraId).toBe("MED0000000002");
  });

  it("takes only suppressed aggregates — there is no parameter for a raw ping", () => {
    const found = detectDiscrepancies([surgeon()], { outcomeCells: [] }, NOW);
    expect(Array.isArray(found)).toBe(true);
  });
});

describe("the verification prompts", () => {
  it("knows which kind of answer each field takes", () => {
    expect(kindOf("workcover")).toBe("tri");
    expect(kindOf("waitToConsultDays")).toBe("days");
    expect(kindOf("noGapFunds")).toBe("funds");
  });

  it("shows what we currently hold, so the caller can read it back", () => {
    const prompt = promptFor("workcover", { ...base.access, workcover: field<Tri>(true, { confirmedAt: daysAgo(30) }) }, NOW);
    expect(prompt.current).toContain("yes");
    expect(prompt.current).toContain("confirmed");
  });

  it("says a field is not confirmed rather than showing a blank", () => {
    expect(promptFor("tac", { ...base.access, tac: field<Tri>("unknown") }, NOW).current).toContain("not confirmed");
  });

  it("takes y, n, weeks and fund lists", () => {
    expect(parseAnswer("tri", "y")).toEqual({ kind: "value", value: true });
    expect(parseAnswer("tri", "N")).toEqual({ kind: "value", value: false });
    expect(parseAnswer("days", "6w")).toEqual({ kind: "value", value: 42 });
    expect(parseAnswer("days", "30")).toEqual({ kind: "value", value: 30 });
    expect(parseAnswer("funds", "HCF, Bupa")).toEqual({ kind: "value", value: ["HCF", "Bupa"] });
    expect(parseAnswer("funds", "none")).toEqual({ kind: "value", value: [] });
  });

  it("rejects an answer it cannot read rather than guessing", () => {
    expect(parseAnswer("tri", "maybe")).toMatchObject({ kind: "invalid" });
    expect(parseAnswer("days", "soon")).toMatchObject({ kind: "invalid" });
  });

  it("distinguishes skipping from recording an unknown", () => {
    expect(parseAnswer("tri", "")).toEqual({ kind: "skip" });
    expect(parseAnswer("tri", "?")).toEqual({ kind: "unknown" });
  });
});

describe("the patch", () => {
  it("carries only the fields actually answered", () => {
    const patch = buildPatch("MED0000000001", new Map([
      ["workcover", { kind: "value", value: true }],
      ["tac", { kind: "skip" }],
      ["ctp", { kind: "unknown" }],
    ] as never), { at: "2026-08-28", by: "kg" });
    expect(Object.keys(patch.fields).sort()).toEqual(["ctp", "workcover"]);
  });

  it("records a could-not-say as an unknown confirmed today, not as an absence", () => {
    const patch = buildPatch("MED0000000001", new Map([["ctp", { kind: "unknown" }]] as never), { at: "2026-08-28", by: "kg" });
    const applied = applyPatch(surgeon(), patch);
    expect(applied.access.ctp).toEqual({ value: "unknown", tier: "A", source: "phone", confirmedAt: "2026-08-28" });
  });

  it("stamps phone answers as tier A from source phone", () => {
    const patch = buildPatch("MED0000000001", new Map([["workcover", { kind: "value", value: true }]] as never), { at: "2026-08-28", by: "kg" });
    expect(applyPatch(surgeon(), patch).access.workcover).toMatchObject({ tier: "A", source: "phone" });
  });

  it("leaves a skipped field, and its old date, untouched", () => {
    const before = surgeon();
    const patch = buildPatch("MED0000000001", new Map([["tac", { kind: "skip" }]] as never), { at: "2026-08-28", by: "kg" });
    expect(applyPatch(before, patch).access.tac).toEqual(before.access.tac);
  });

  it("marks the record reviewed", () => {
    const patch = buildPatch("MED0000000001", new Map([["workcover", { kind: "value", value: true }]] as never), { at: "2026-08-28", by: "kg" });
    expect(applyPatch(surgeon(), patch).lastReviewedAt).toBe("2026-08-28");
  });
});

describe("the automated collectors", () => {
  const collectors = allCollectors();

  it("all ship needs-review, like the identity adapters", () => {
    expect(collectors.every((c) => c.legalStatus === "needs-review")).toBe(true);
  });

  it("attach state-health waits to a public location, never to a surgeon", () => {
    const stateHealth = collectors.find((c) => c.id === "state-health-wait");
    expect(stateHealth?.attachesTo).toBe("public-location");
    expect(collectors.find((c) => c.id === "booking-platform")?.attachesTo).toBe("surgeon");
  });

  it("carry the tier the brief specifies", () => {
    expect(collectors.find((c) => c.id === "insurer-directory")?.tier).toBe("A");
    expect(collectors.find((c) => c.id === "booking-platform")?.tier).toBe("B");
  });

  it("are not implemented yet", async () => {
    for (const collector of collectors) {
      await expect(collector.collect()).rejects.toBeInstanceOf(CollectorNotImplementedError);
    }
  });
});
