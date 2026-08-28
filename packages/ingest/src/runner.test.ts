import { describe, expect, it, vi } from "vitest";
import { AdapterNotClearedError, type PartialSurgeon, type RawSnapshot, type SourceAdapter } from "./types";
import { runAdapters, unclearedAdapters } from "./runner";

const snapshot = (adapterId: string): RawSnapshot => ({
  adapterId,
  fetchedAt: "2026-08-28T00:00:00.000Z",
  url: "https://example.test/list",
  contentHash: "abc123def456",
  body: "<html></html>",
});

const partial = (over: Partial<PartialSurgeon> = {}): PartialSurgeon => ({
  ahpraId: "MED0000000001",
  familyName: "Aldergrove",
  givenNames: "Alice",
  postcodeHint: "3144",
  specialistRegistrationSince: "2010-01-01",
  tags: [{ bucket: "knee_sports", evidence: "Australian Knee Society member" }],
  locations: [],
  languages: ["English"],
  telehealth: null,
  ...over,
});

function adapter(over: Partial<SourceAdapter> = {}): SourceAdapter {
  const id = over.id ?? "test-adapter";
  return {
    id,
    legalStatus: "cleared",
    defaultTier: "A",
    description: "test",
    fetch: vi.fn(async () => snapshot(id)),
    parse: vi.fn(async () => [partial()]),
    ...over,
  };
}

describe("the legal gate", () => {
  it("refuses an adapter that has not been cleared", async () => {
    await expect(runAdapters([adapter({ legalStatus: "needs-review" })])).rejects.toBeInstanceOf(
      AdapterNotClearedError,
    );
  });

  it("refuses a blocked adapter too", async () => {
    await expect(runAdapters([adapter({ legalStatus: "blocked" })])).rejects.toBeInstanceOf(
      AdapterNotClearedError,
    );
  });

  it("fetches NOTHING when one adapter in the batch is uncleared", async () => {
    const clean = adapter({ id: "clean" });
    const dirty = adapter({ id: "dirty", legalStatus: "needs-review" });
    await expect(runAdapters([clean, dirty])).rejects.toBeInstanceOf(AdapterNotClearedError);
    // The point of checking every adapter before running any: no snapshot from an unsigned-off
    // batch reaches disk.
    expect(clean.fetch).not.toHaveBeenCalled();
  });

  it("names the offending adapter and its status", async () => {
    let error: AdapterNotClearedError | null = null;
    try {
      await runAdapters([adapter({ id: "society-knee", legalStatus: "needs-review" })]);
    } catch (thrown) {
      error = thrown as AdapterNotClearedError;
    }
    expect(error).toBeInstanceOf(AdapterNotClearedError);
    expect(error?.adapterId).toBe("society-knee");
    expect(error?.legalStatus).toBe("needs-review");
    expect(error?.message).toContain("by a human first");
  });

  it("can be asked to skip and report instead, but never by default", async () => {
    const clean = adapter({ id: "clean" });
    const dirty = adapter({ id: "dirty", legalStatus: "needs-review" });
    const report = await runAdapters([clean, dirty], { skipUncleared: true });
    expect(report.ran).toEqual(["clean"]);
    expect(report.refused).toEqual([{ adapterId: "dirty", legalStatus: "needs-review" }]);
    expect(dirty.fetch).not.toHaveBeenCalled();
  });

  it("lists what would be refused without running anything", () => {
    expect(unclearedAdapters([adapter({ id: "a" }), adapter({ id: "b", legalStatus: "blocked" })])).toEqual([
      { adapterId: "b", legalStatus: "blocked" },
    ]);
  });
});

describe("tier stamping", () => {
  it("comes from the adapter's defaultTier, not from anything the adapter parsed", async () => {
    const report = await runAdapters([adapter({ defaultTier: "C" })]);
    expect(report.records[0]?.tier).toBe("C");
  });

  it("a parsed record has no field in which to claim a tier at all", async () => {
    const report = await runAdapters([adapter({ parse: async () => [partial()] })]);
    expect(report.records[0]?.partial).not.toHaveProperty("tier");
  });

  it("rejects a parsed record that tries to carry one", async () => {
    const report = await runAdapters([
      adapter({ parse: async () => [{ ...partial(), tier: "A" } as unknown as PartialSurgeon] }),
    ]);
    expect(report.ran).toEqual([]);
    expect(report.failures[0]?.adapterId).toBe("test-adapter");
  });
});

describe("run reporting", () => {
  it("carries a source record whose hash ties back to the snapshot", async () => {
    const report = await runAdapters([adapter()]);
    const record = report.records[0]!;
    expect(record.sourceRecord.snapshotHash).toBe("abc123def456");
    expect(record.sourceRecord.adapterId).toBe("test-adapter");
    expect(record.sourceRecord.url).toBe("https://example.test/list");
  });

  it("a failing adapter does not take the run down with it", async () => {
    const report = await runAdapters([
      adapter({ id: "broken", fetch: async () => { throw new Error("host unreachable"); } }),
      adapter({ id: "fine" }),
    ]);
    expect(report.ran).toEqual(["fine"]);
    expect(report.failures).toEqual([{ adapterId: "broken", message: "host unreachable" }]);
  });
});
