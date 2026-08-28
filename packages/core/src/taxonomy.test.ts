// The table is data, so the test checks it as data: total, valid, non-empty, and ordered.
// A new region or category fails here until somebody writes down where it points.

import { describe, expect, it } from "vitest";
import {
  ANATOMICAL_REGIONS,
  bucketsFor,
  CATEGORY_COPY,
  REFERRAL_CATEGORIES,
  REGION_CATEGORY_TO_BUCKETS,
  REGION_COPY,
} from "./taxonomy";
import { SUBSPECIALTIES } from "./schema";

describe("REGION_CATEGORY_TO_BUCKETS", () => {
  it("is total — every region crossed with every category", () => {
    for (const region of ANATOMICAL_REGIONS) {
      for (const category of REFERRAL_CATEGORIES) {
        expect(REGION_CATEGORY_TO_BUCKETS[region]?.[category], `${region} x ${category}`).toBeDefined();
      }
    }
  });

  it("has no row that would return nobody", () => {
    for (const region of ANATOMICAL_REGIONS) {
      for (const category of REFERRAL_CATEGORIES) {
        expect(bucketsFor(region, category).length, `${region} x ${category}`).toBeGreaterThan(0);
      }
    }
  });

  it("names only real buckets", () => {
    for (const region of ANATOMICAL_REGIONS) {
      for (const category of REFERRAL_CATEGORIES) {
        for (const bucket of bucketsFor(region, category)) {
          expect(SUBSPECIALTIES).toContain(bucket);
        }
      }
    }
  });

  it("never repeats a bucket within a row — order is priority, not multiplicity", () => {
    for (const region of ANATOMICAL_REGIONS) {
      for (const category of REFERRAL_CATEGORIES) {
        const row = bucketsFor(region, category);
        expect(new Set(row).size, `${region} x ${category}`).toBe(row.length);
      }
    }
  });

  it("carries no key outside the declared regions", () => {
    expect(Object.keys(REGION_CATEGORY_TO_BUCKETS).sort()).toEqual([...ANATOMICAL_REGIONS].sort());
  });
});

describe("copy", () => {
  it("names every region and category, so no screen invents its own wording", () => {
    for (const region of ANATOMICAL_REGIONS) expect(REGION_COPY[region]).toBeTruthy();
    for (const category of REFERRAL_CATEGORIES) expect(CATEGORY_COPY[category]).toBeTruthy();
  });
});

describe("rows the founder should read as clinical claims", () => {
  it("keeps knee sports work distinct from knee arthroplasty", () => {
    expect(bucketsFor("knee", "sports_soft_tissue")).toEqual(["knee_sports"]);
    expect(bucketsFor("knee", "joint_replacement")).toEqual(["hip_knee_arthroplasty"]);
  });

  it("sends every tumour category to the tumour bucket first", () => {
    for (const region of ANATOMICAL_REGIONS) {
      expect(bucketsFor(region, "tumour")[0]).toBe("tumour");
    }
  });

  it("sends every paediatric category to the paediatric bucket first", () => {
    for (const region of ANATOMICAL_REGIONS) {
      expect(bucketsFor(region, "paediatric")[0]).toBe("paediatric");
    }
  });

  it("offers the whole directory when neither region nor category is specified", () => {
    expect(bucketsFor("general", "unspecified")).toEqual([...SUBSPECIALTIES]);
  });
});
