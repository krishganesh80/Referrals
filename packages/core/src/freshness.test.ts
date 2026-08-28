// Table-driven across every field and every boundary. The boundaries are checked one day
// either side as well as on the day itself, because an off-by-one here silently ages the whole
// dataset a day early or a day late and nothing else in the system would notice.

import { describe, expect, it } from "vitest";
import { ACCESS_FIELD_KEYS, type AccessField, type AccessFieldKey } from "./schema";
import { ageInDays, freshness, FRESHNESS_THRESHOLDS } from "./freshness";

const NOW = new Date("2026-08-28T00:00:00.000Z");

function fieldAged(days: number, value: unknown = true): AccessField<unknown> {
  const at = new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return { value: value as never, tier: "A", source: "phone", confirmedAt: at };
}

describe("the threshold table", () => {
  it("covers every access field", () => {
    expect(Object.keys(FRESHNESS_THRESHOLDS).sort()).toEqual([...ACCESS_FIELD_KEYS].sort());
  });

  it("matches the brief's half-lives", () => {
    expect(FRESHNESS_THRESHOLDS).toMatchObject({
      workcover: { freshUnderDays: 180, staleOverDays: 365 },
      tac: { freshUnderDays: 180, staleOverDays: 365 },
      ctp: { freshUnderDays: 180, staleOverDays: 365 },
      dva: { freshUnderDays: 180, staleOverDays: 365 },
      comcare: { freshUnderDays: 180, staleOverDays: 365 },
      noGapFunds: { freshUnderDays: 180, staleOverDays: 365 },
      booksOpen: { freshUnderDays: 21, staleOverDays: 60 },
      waitToConsultDays: { freshUnderDays: 30, staleOverDays: 90 },
      waitToSurgeryDays: { freshUnderDays: 60, staleOverDays: 120 },
    });
  });
});

describe.each(ACCESS_FIELD_KEYS)("%s", (key: AccessFieldKey) => {
  const { freshUnderDays, staleOverDays } = FRESHNESS_THRESHOLDS[key];
  const sample = key === "noGapFunds" ? ["HCF"] : key.endsWith("Days") ? 30 : true;

  it("is fresh on the day it was confirmed", () => {
    expect(freshness(key, fieldAged(0, sample), NOW)).toBe("fresh");
  });

  it("is fresh one day under the fresh boundary", () => {
    expect(freshness(key, fieldAged(freshUnderDays - 1, sample), NOW)).toBe("fresh");
  });

  it("is ageing on the fresh boundary itself", () => {
    expect(freshness(key, fieldAged(freshUnderDays, sample), NOW)).toBe("ageing");
  });

  it("is still ageing on the stale boundary itself", () => {
    expect(freshness(key, fieldAged(staleOverDays, sample), NOW)).toBe("ageing");
  });

  it("is stale one day past the stale boundary", () => {
    expect(freshness(key, fieldAged(staleOverDays + 1, sample), NOW)).toBe("stale");
  });

  it("is unknown when the value is unknown, however recently it was looked at", () => {
    expect(freshness(key, fieldAged(0, "unknown"), NOW)).toBe("unknown");
    expect(freshness(key, fieldAged(9999, "unknown"), NOW)).toBe("unknown");
  });
});

describe("ageInDays", () => {
  it("counts whole days", () => {
    expect(ageInDays("2026-08-28", NOW)).toBe(0);
    expect(ageInDays("2026-08-27", NOW)).toBe(1);
    expect(ageInDays("2025-08-28", NOW)).toBe(365);
  });

  it("clamps a future confirmation to zero rather than reporting a negative age", () => {
    expect(ageInDays("2027-01-01", NOW)).toBe(0);
  });

  it("is stable across a daylight-saving boundary", () => {
    // Australian DST starts on the first Sunday in October. Both sides must count the same.
    const octoberNow = new Date("2026-10-15T00:00:00.000Z");
    expect(ageInDays("2026-10-01", octoberNow)).toBe(14);
  });
});
