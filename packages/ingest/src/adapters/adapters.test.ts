// The register: what sources exist, what class of evidence each produces, and whether a human
// has checked its terms. The first test is the one that matters — if it ever goes green with a
// `cleared` adapter that nobody signed off, the gate has been bypassed in code review.

import { describe, expect, it } from "vitest";
import { FetchPolicy } from "../fetch-policy";
import { unclearedAdapters } from "../runner";
import {
  ahpraRegisterAdapter,
  aoaFeedAdapter,
  hospitalCredentialingAdapter,
  NotImplementedError,
  practiceSiteAdapter,
  publicationAdapter,
  subspecialtySocietyAdapters,
  SUBSPECIALTY_SOCIETIES,
} from "./index";

const policy = new FetchPolicy(
  { httpGet: async () => ({ status: 200, body: "" }), now: () => 0, sleep: async () => undefined, hash: () => "h" },
  { contactEmail: "data@referral.test" },
);

const all = [
  ahpraRegisterAdapter(policy),
  ...subspecialtySocietyAdapters(policy),
  hospitalCredentialingAdapter(policy, "https://hospital.test/specialists", "eastbourne"),
  publicationAdapter(policy),
  practiceSiteAdapter(policy, "https://practice.test/our-surgeons", "aldergrove"),
  aoaFeedAdapter(policy),
];

describe("the source register", () => {
  it("ships every adapter as needs-review — not one is cleared to run", () => {
    expect(all.every((a) => a.legalStatus === "needs-review")).toBe(true);
    expect(unclearedAdapters(all)).toHaveLength(all.length);
  });

  it("gives every adapter a unique id", () => {
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
  });

  it("gives every adapter a description, so the register says what the source is", () => {
    expect(all.every((a) => a.description.length > 20)).toBe(true);
  });

  it("assigns the tier the brief specifies for each class", () => {
    expect(ahpraRegisterAdapter(policy).defaultTier).toBe("A");
    expect(subspecialtySocietyAdapters(policy).every((a) => a.defaultTier === "A")).toBe(true);
    expect(hospitalCredentialingAdapter(policy, "https://h.test/x", "k").defaultTier).toBe("B");
    expect(publicationAdapter(policy).defaultTier).toBe("B");
    expect(practiceSiteAdapter(policy, "https://p.test/x", "k").defaultTier).toBe("C");
    expect(aoaFeedAdapter(policy).defaultTier).toBe("A");
  });

  it("covers all seven sub-specialty societies", () => {
    expect(SUBSPECIALTY_SOCIETIES).toHaveLength(7);
    expect(subspecialtySocietyAdapters(policy)).toHaveLength(7);
  });

  it("uses PubMed's documented API rather than scraping it", () => {
    expect(publicationAdapter(policy).description).toContain("documented public API");
  });

  it("marks the AOA feed as identity only — access data never comes from it", () => {
    expect(aoaFeedAdapter(policy).description).toContain("never access data");
  });
});

describe("parsers", () => {
  it("are not implemented — phase one ships the interface and its tests", async () => {
    for (const adapter of all) {
      await expect(
        adapter.parse({ adapterId: adapter.id, fetchedAt: "2026-08-28T00:00:00.000Z", url: null, contentHash: "h", body: "" }),
      ).rejects.toBeInstanceOf(NotImplementedError);
    }
  });
});
