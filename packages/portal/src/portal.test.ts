import { describe, expect, it } from "vitest";
import { makeFixtureSurgeons, unknownAccessRecord, type AccessField, type AccessRecord, type Tri } from "@referral/core";
import { checkMagicLink, consume, hashToken, issueMagicLink, TOKEN_TTL_MINUTES } from "./magic-link";
import { applySubmission, daysForBand, SubmissionSchema, WAIT_BANDS } from "./submission";
import { completenessOf, COMPLETENESS_WEIGHT } from "./completeness";
import { renderNudgeEmail } from "./nudge-email";
import { buildReviewedExport, ExportRowSchema, type PortalRecord } from "./export";

const NOW = new Date("2026-08-28T00:00:00.000Z");
const TODAY = "2026-08-28";
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);

describe("magic links", () => {
  it("never stores the token in the clear", () => {
    const { token, record } = issueMagicLink("rooms@example.com", "MED0000000001", NOW);
    expect(record).not.toHaveProperty("token");
    expect(JSON.stringify(record)).not.toContain(token);
    expect(record.tokenHash).toBe(hashToken(token));
  });

  it("accepts a fresh link", () => {
    const { token, record } = issueMagicLink("rooms@example.com", "MED0000000001", NOW);
    expect(checkMagicLink(token, [record], NOW)).toMatchObject({ ok: true });
  });

  it("refuses an expired link", () => {
    const { token, record } = issueMagicLink("rooms@example.com", "MED0000000001", NOW);
    const later = new Date(NOW.getTime() + (TOKEN_TTL_MINUTES + 1) * 60_000);
    expect(checkMagicLink(token, [record], later)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a link that has already been used", () => {
    const { token, record } = issueMagicLink("rooms@example.com", "MED0000000001", NOW);
    expect(checkMagicLink(token, [consume(record, NOW)], NOW)).toEqual({ ok: false, reason: "already-used" });
  });

  it("refuses a token nobody issued", () => {
    const { record } = issueMagicLink("rooms@example.com", "MED0000000001", NOW);
    expect(checkMagicLink("f".repeat(64), [record], NOW)).toEqual({ ok: false, reason: "unknown" });
  });

  it("issues a different token every time", () => {
    const a = issueMagicLink("rooms@example.com", "MED0000000001", NOW);
    const b = issueMagicLink("rooms@example.com", "MED0000000001", NOW);
    expect(a.token).not.toBe(b.token);
  });

  it("has no password anywhere in the model", () => {
    const { record } = issueMagicLink("rooms@example.com", "MED0000000001", NOW);
    expect(Object.keys(record).join(" ").toLowerCase()).not.toContain("password");
  });
});

describe("the one screen", () => {
  const held = (): AccessRecord => unknownAccessRecord(daysAgo(200));

  it("writes everything as tier S from the portal", () => {
    const next = applySubmission(held(), SubmissionSchema.parse({ ahpraId: "MED0000000001", workcover: true, confirmUnchanged: false }), TODAY);
    expect(next.workcover).toEqual({ value: true, tier: "S", source: "portal", confirmedAt: TODAY });
  });

  it("stores a wait band as the days the matcher will discount", () => {
    const next = applySubmission(held(), SubmissionSchema.parse({ ahpraId: "MED0000000001", waitToConsultBand: "2-4-weeks", confirmUnchanged: false }), TODAY);
    expect(next.waitToConsultDays.value).toBe(daysForBand("2-4-weeks"));
    expect(next.waitToConsultDays.tier).toBe("S");
  });

  it("offers ranges rather than a number, because nobody knows their wait to the day", () => {
    expect(WAIT_BANDS.length).toBeGreaterThanOrEqual(5);
    expect(WAIT_BANDS.every((b) => b.days > 0)).toBe(true);
  });

  it("confirm-all re-dates untouched fields, which is the point of the screen", () => {
    const before: AccessRecord = { ...held(), workcover: { value: true, tier: "S", source: "portal", confirmedAt: daysAgo(300) } as AccessField<Tri> };
    const next = applySubmission(before, SubmissionSchema.parse({ ahpraId: "MED0000000001", confirmUnchanged: true }), TODAY);
    expect(next.workcover.confirmedAt).toBe(TODAY);
  });

  it("confirm-all never launders a phone-verified fact down to self-reported", () => {
    const before: AccessRecord = { ...held(), tac: { value: true, tier: "A", source: "phone", confirmedAt: daysAgo(300) } as AccessField<Tri> };
    const next = applySubmission(before, SubmissionSchema.parse({ ahpraId: "MED0000000001", confirmUnchanged: true }), TODAY);
    expect(next.tac).toEqual(before.tac);
  });

  it("lets a practice say they do not know, rather than forcing a yes or no", () => {
    const next = applySubmission(held(), SubmissionSchema.parse({ ahpraId: "MED0000000001", comcare: "unknown", confirmUnchanged: false }), TODAY);
    expect(next.comcare).toMatchObject({ value: "unknown", confirmedAt: TODAY });
  });

  it("rejects a field the screen does not offer", () => {
    expect(SubmissionSchema.safeParse({ ahpraId: "MED0000000001", confirmUnchanged: false, referralWeight: 1 }).success).toBe(false);
  });
});

describe("completeness", () => {
  it("is zero when nothing is confirmed, and every field is a visible gap", () => {
    const result = completenessOf(unknownAccessRecord(TODAY), NOW);
    expect(result.percent).toBe(0);
    expect(result.gaps).toHaveLength(Object.keys(COMPLETENESS_WEIGHT).length);
  });

  it("puts the heaviest gap first — the one worth thirty seconds", () => {
    expect(completenessOf(unknownAccessRecord(TODAY), NOW).gaps[0]?.key).toBe("booksOpen");
  });

  it("weights by what a referrer needs, not by field count", () => {
    expect(COMPLETENESS_WEIGHT.booksOpen).toBeGreaterThan(COMPLETENESS_WEIGHT.bulkBillsInitial);
  });

  it("says what a GP currently sees, in the specialist's language", () => {
    const gap = completenessOf(unknownAccessRecord(TODAY), NOW).gaps.find((g) => g.key === "tac");
    expect(gap?.consequence).toContain("cannot see you as accepting it");
  });

  it("reaches 100 when a real record is fully fresh", () => {
    const surgeon = makeFixtureSurgeons({ count: 1 })[0]!;
    const fresh = Object.fromEntries(
      Object.entries(surgeon.access).map(([k, f]) => [k, { ...f, value: f.value === "unknown" ? (k === "noGapFunds" ? [] : k.endsWith("Days") ? 20 : true) : f.value, confirmedAt: TODAY }]),
    ) as AccessRecord;
    expect(completenessOf(fresh, NOW).percent).toBe(100);
  });
});

describe("the monthly nudge", () => {
  const completeness = completenessOf(unknownAccessRecord(TODAY), NOW);

  it("leads with the gaps and what they cost", () => {
    const email = renderNudgeEmail({
      displayName: "Aldergrove", completeness, referralsLastMonth: 12,
      signInUrl: "https://portal.example/x", monthLabel: "July",
    });
    expect(email.subject).toContain("unconfirmed");
    expect(email.text).toContain("cannot see you as accepting it");
  });

  it("uses the suppressed outcome aggregate when there is one", () => {
    const email = renderNudgeEmail({
      displayName: "Aldergrove", completeness, referralsLastMonth: 12,
      signInUrl: "https://portal.example/x", monthLabel: "July",
    });
    expect(email.text).toContain("12 referrals recorded through the tool reached you in July");
  });

  it("reads well when the cell is below the k-anonymity threshold, which is the normal case", () => {
    const email = renderNudgeEmail({
      displayName: "Aldergrove", completeness, referralsLastMonth: null,
      signInUrl: "https://portal.example/x", monthLabel: "July",
    });
    expect(email.text).not.toContain("null");
    expect(email.text).not.toContain("referrals recorded");
    expect(email.text).toContain("Confirming takes about thirty seconds");
  });

  it("never claims to know what GPs searched for", () => {
    // The brief's original usage line needed search criteria and a postcode. Collecting those
    // would contradict constraint 2, so no rendering of this email may imply we have them.
    const email = renderNudgeEmail({
      displayName: "Aldergrove", completeness, referralsLastMonth: 12,
      signInUrl: "https://portal.example/x", monthLabel: "July",
    });
    expect(email.text.toLowerCase()).not.toContain("filtered for");
    expect(email.text.toLowerCase()).not.toContain("in your postcode");
    expect(email.text.toLowerCase()).not.toContain("searched");
  });

  it("says plainly that visibility cannot be bought", () => {
    const email = renderNudgeEmail({
      displayName: "Aldergrove", completeness, referralsLastMonth: null,
      signInUrl: "https://portal.example/x", monthLabel: "July",
    });
    expect(email.text).toContain("Nothing on this site can be paid for");
  });

  it("congratulates rather than nags when nothing needs doing", () => {
    const surgeon = makeFixtureSurgeons({ count: 1 })[0]!;
    const fresh = Object.fromEntries(
      Object.entries(surgeon.access).map(([k, f]) => [k, { ...f, value: f.value === "unknown" ? (k === "noGapFunds" ? [] : k.endsWith("Days") ? 20 : true) : f.value, confirmedAt: TODAY }]),
    ) as AccessRecord;
    const email = renderNudgeEmail({
      displayName: "Aldergrove", completeness: completenessOf(fresh, NOW), referralsLastMonth: null,
      signInUrl: "https://portal.example/x", monthLabel: "July",
    });
    expect(email.subject).toBe("Your referral profile is up to date");
    expect(email.text).toContain("Nothing needs doing");
  });
});

describe("the isolation rule", () => {
  const record: PortalRecord = {
    ahpraId: "MED0000000001",
    practiceEmail: "rooms@example.com",
    contactName: "Practice Manager",
    access: unknownAccessRecord(TODAY),
  };

  it("carries the access half and nothing else", () => {
    const exported = buildReviewedExport([record], { name: "kg", at: TODAY }, NOW.toISOString());
    expect(Object.keys(exported.rows[0]!).sort()).toEqual(["access", "ahpraId"]);
  });

  it("cannot carry PII even if somebody adds it to the row", () => {
    expect(ExportRowSchema.safeParse({ ahpraId: "MED0000000001", access: unknownAccessRecord(TODAY), practiceEmail: "rooms@example.com" }).success).toBe(false);
  });

  it("has no PII anywhere in the serialised export", () => {
    const json = JSON.stringify(buildReviewedExport([record], { name: "kg", at: TODAY }, NOW.toISOString()));
    expect(json).not.toContain("rooms@example.com");
    expect(json).not.toContain("Practice Manager");
  });

  it("records who reviewed it — an unreviewed export cannot be constructed", () => {
    const exported = buildReviewedExport([record], { name: "kg", at: TODAY }, NOW.toISOString());
    expect(exported.reviewedBy).toBe("kg");
    expect(() => buildReviewedExport([record], { name: "", at: TODAY }, NOW.toISOString())).toThrow();
  });

  it("is ordered, so two exports of the same data diff cleanly", () => {
    const many = ["MED0000000003", "MED0000000001", "MED0000000002"].map((id) => ({ ...record, ahpraId: id }));
    expect(buildReviewedExport(many, { name: "kg", at: TODAY }, NOW.toISOString()).rows.map((r) => r.ahpraId)).toEqual([
      "MED0000000001", "MED0000000002", "MED0000000003",
    ]);
  });
});
