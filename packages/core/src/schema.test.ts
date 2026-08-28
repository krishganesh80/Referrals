import { describe, expect, it } from "vitest";
import {
  AccessRecordSchema,
  PracticeLocationSchema,
  SurgeonSchema,
  accessFieldSchema,
  TriSchema,
} from "./schema";
import { makeFixtureSurgeons } from "./fixtures";

const TriField = accessFieldSchema(TriSchema);

const goodField = { value: true, tier: "A", source: "phone", confirmedAt: "2026-08-01" } as const;

describe("round trip", () => {
  it("every fixture surgeon parses, and parsing is idempotent", () => {
    for (const surgeon of makeFixtureSurgeons({ count: 50 })) {
      const parsed = SurgeonSchema.parse(surgeon);
      expect(SurgeonSchema.parse(parsed)).toEqual(parsed);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
    }
  });

  it("the unknown-heavy set parses too", () => {
    for (const surgeon of makeFixtureSurgeons({ count: 50, unknownRatio: 0.8, seed: 8080 })) {
      expect(() => SurgeonSchema.parse(surgeon)).not.toThrow();
    }
  });
});

describe("'unknown' is a value, not an absence", () => {
  it("accepts the literal", () => {
    expect(TriField.parse({ ...goodField, value: "unknown" }).value).toBe("unknown");
  });

  it("rejects null", () => {
    expect(() => TriField.parse({ ...goodField, value: null })).toThrow();
  });

  it("rejects a missing value", () => {
    const { value: _drop, ...rest } = goodField;
    expect(() => TriField.parse(rest)).toThrow();
  });
});

describe("derived facts cannot be stored", () => {
  it("a stored staleness fails to parse rather than being ignored", () => {
    expect(() => TriField.parse({ ...goodField, staleness: "fresh" })).toThrow();
  });

  it("a commercial ranking field cannot enter a surgeon record", () => {
    const [surgeon] = makeFixtureSurgeons({ count: 1 });
    expect(() => SurgeonSchema.parse({ ...surgeon, sponsored: true })).toThrow();
    expect(() => SurgeonSchema.parse({ ...surgeon, boost: 2 })).toThrow();
  });
});

describe("provenance cannot contradict itself", () => {
  it("tier S must name the portal as its source", () => {
    expect(() => TriField.parse({ ...goodField, tier: "S", source: "phone" })).toThrow();
  });

  it("a portal source must carry tier S", () => {
    expect(() => TriField.parse({ ...goodField, tier: "A", source: "portal" })).toThrow();
  });

  it("the honest pairing parses", () => {
    expect(() => TriField.parse({ ...goodField, tier: "S", source: "portal" })).not.toThrow();
  });

  it("access data has no tier C — nothing on a practice website dates itself", () => {
    expect(() => TriField.parse({ ...goodField, tier: "C" })).toThrow();
  });
});

describe("published department waits stay on public locations", () => {
  const base = {
    id: "loc-1",
    kind: "rooms",
    name: "Rooms",
    address: "1 Test St",
    suburb: "Malvern",
    state: "VIC",
    postcode: "3144",
    lat: -37.8,
    lng: 145.0,
    departmentWait: null,
  } as const;

  it("a private location cannot carry one", () => {
    expect(() =>
      PracticeLocationSchema.parse({
        ...base,
        sector: "private",
        departmentWait: {
          waitToConsultDays: { value: 90, tier: "A", source: "state-health", confirmedAt: "2026-08-01" },
          waitToSurgeryDays: { value: 180, tier: "A", source: "state-health", confirmedAt: "2026-08-01" },
        },
      }),
    ).toThrow();
  });

  it("a public location may", () => {
    expect(() =>
      PracticeLocationSchema.parse({
        ...base,
        sector: "public",
        departmentWait: {
          waitToConsultDays: { value: 90, tier: "A", source: "state-health", confirmedAt: "2026-08-01" },
          waitToSurgeryDays: { value: 180, tier: "A", source: "state-health", confirmedAt: "2026-08-01" },
        },
      }),
    ).not.toThrow();
  });
});

describe("dates", () => {
  it("rejects a date that does not exist", () => {
    expect(() => TriField.parse({ ...goodField, confirmedAt: "2026-02-31" })).toThrow();
  });

  it("rejects a timestamp where a date belongs", () => {
    expect(() => TriField.parse({ ...goodField, confirmedAt: "2026-08-01T00:00:00Z" })).toThrow();
  });
});

describe("AccessRecord", () => {
  it("requires every field — a missing one is not the same as an unknown one", () => {
    const [surgeon] = makeFixtureSurgeons({ count: 1 });
    const { workcover: _drop, ...rest } = surgeon!.access;
    expect(() => AccessRecordSchema.parse(rest)).toThrow();
  });
});
