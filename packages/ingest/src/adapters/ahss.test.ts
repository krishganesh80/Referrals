// Tested against a committed snapshot of the markup the site actually serves, captured
// 2026-08-28. Writing a parser against imagined markup is how a scraper passes its tests and
// returns nothing in production.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractAhssEntries,
  parseAhssDirectory,
  postcodeFrom,
  splitName,
  stateFrom,
  ahssDirectoryAdapter,
} from "./ahss";
import { FetchPolicy } from "../fetch-policy";

const html = readFileSync(fileURLToPath(new URL("./__fixtures__/ahss-directory.html", import.meta.url)), "utf8");

describe("extraction against the real markup", () => {
  const entries = extractAhssEntries(html);

  it("finds every directory entry in the snapshot", () => {
    expect(entries.length).toBe(3);
  });

  it("reads the display name from the name block", () => {
    expect(entries[0]?.displayName).toBe("Nav Aggarwal");
  });

  it("reads the labelled practice name and address", () => {
    expect(entries[0]?.practiceName).toBe("Southern Hand Surgery");
    expect(entries[0]?.practiceAddress).toBe("Suite 303, 13A Montgomery St, Kogarah");
  });

  it("keeps the directory's own user id, which is the only stable handle it publishes", () => {
    expect(entries[0]?.directoryUserId).toBe("user-802");
  });

  it("does not mistake the layout class for a state", () => {
    // The live page classes this column VIC while the practice is in Kogarah, NSW.
    expect(stateFrom(entries[0]?.practiceAddress ?? null)).toBeNull();
  });
});

describe("mapping to PartialSurgeon", () => {
  const partials = parseAhssDirectory(html);

  it("leaves identity unresolved — the directory publishes no AHPRA number", () => {
    expect(partials.every((p) => p.ahpraId === null)).toBe(true);
  });

  it("tags every member into the hand and wrist bucket, with the society as the evidence", () => {
    expect(partials[0]?.tags).toEqual([
      { bucket: "hand_wrist", evidence: "Australian Hand Surgery Society member" },
    ]);
  });

  it("claims no tier of its own — the runner stamps that from the adapter", () => {
    for (const partial of partials) {
      for (const tag of partial.tags) expect(tag).not.toHaveProperty("tier");
    }
  });

  it("emits no practice location: a directory line has no geocode and often no state", () => {
    expect(partials.every((p) => p.locations.length === 0)).toBe(true);
  });

  it("splits the name last-token-first", () => {
    expect(partials[0]).toMatchObject({ givenNames: "Nav", familyName: "Aggarwal" });
  });
});

describe("name splitting", () => {
  it("handles a two-part name", () => {
    expect(splitName("Will Alexander")).toEqual({ givenNames: "Will", familyName: "Alexander" });
  });

  it("treats everything before the last token as given names", () => {
    expect(splitName("Mary Jane Watson")).toEqual({ givenNames: "Mary Jane", familyName: "Watson" });
  });

  it("gets a compound surname wrong, which is why these records go to review", () => {
    // Documented, not hidden: the split is a heuristic and the review queue is the safety net.
    expect(splitName("Anna Van Der Berg")).toEqual({ givenNames: "Anna Van Der", familyName: "Berg" });
  });

  it("survives a single-token name without throwing", () => {
    expect(splitName("Cher")).toEqual({ givenNames: "Cher", familyName: "Cher" });
  });
});

describe("postcode extraction", () => {
  it("takes the last four-digit group, which is where a postcode sits in an AU address", () => {
    expect(postcodeFrom("Suite 3, 100 Bourke St, Melbourne VIC 3000")).toBe("3000");
  });

  it("is null when the address carries none", () => {
    expect(postcodeFrom("Suite 303, 13A Montgomery St, Kogarah")).toBeNull();
    expect(postcodeFrom(null)).toBeNull();
  });
});

describe("the adapter", () => {
  const policy = new FetchPolicy(
    { httpGet: async () => ({ status: 200, body: "" }), now: () => 0, sleep: async () => undefined, hash: () => "h" },
    { contactEmail: "data@referral.test" },
  );

  it("still ships needs-review — clearance is applied from the register, never hardcoded", () => {
    expect(ahssDirectoryAdapter(policy).legalStatus).toBe("needs-review");
  });

  it("is tier A", () => {
    expect(ahssDirectoryAdapter(policy).defaultTier).toBe("A");
  });

  it("parses a fetched snapshot end to end", async () => {
    const parsed = await ahssDirectoryAdapter(policy).parse({
      adapterId: "society-hand",
      fetchedAt: "2026-08-28T00:00:00.000Z",
      url: null,
      contentHash: "h",
      body: html,
    });
    expect(parsed).toHaveLength(3);
  });
});
