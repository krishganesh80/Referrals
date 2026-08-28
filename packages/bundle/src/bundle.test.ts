import { describe, expect, it } from "vitest";
import { makeFixtureSurgeons } from "@referral/core";
import {
  acceptBundle,
  applyAccessDelta,
  buildAccessDelta,
  buildFullBundle,
  compareVersions,
  generateSigningKey,
  nodeVerifier,
  parseAccessDelta,
  parseFullBundle,
  pruneVersions,
  sha256Hex,
  signManifest,
} from "./bundle";
import { BundleRejected, ManifestSchema, canonicalManifestBytes } from "./manifest";

const AT = "2026-08-28T00:00:00.000Z";
const surgeons = makeFixtureSurgeons({ count: 50 });
const key = generateSigningKey("bundle-2026-08");
const verifier = nodeVerifier({ [key.keyId]: key.publicKeyPem });

describe("the full channel", () => {
  const built = buildFullBundle(surgeons, { version: "2026-08-28.1", generatedAt: AT });

  it("round-trips every record", () => {
    expect(parseFullBundle(built.payload)).toEqual([...surgeons].sort((a, b) => a.ahpraId.localeCompare(b.ahpraId)));
  });

  it("counts what it contains", () => {
    expect(built.manifest.recordCount).toBe(50);
  });

  it("stays comfortably under a megabyte", () => {
    expect(built.payload.byteLength).toBeLessThan(1024 * 1024);
  });

  it("is a full bundle, based on nothing", () => {
    expect(built.manifest.channel).toBe("full");
    expect(built.manifest.basedOnVersion).toBeNull();
  });
});

describe("determinism", () => {
  it("the same records produce byte-identical payloads", () => {
    const a = buildFullBundle(surgeons, { version: "2026-08-28.1", generatedAt: AT });
    const b = buildFullBundle(surgeons, { version: "2026-08-28.1", generatedAt: AT });
    expect(Buffer.compare(Buffer.from(a.payload), Buffer.from(b.payload))).toBe(0);
    expect(a.manifest.sha256).toBe(b.manifest.sha256);
  });

  it("the caller's ordering cannot change the bytes", () => {
    const forward = buildFullBundle(surgeons, { version: "2026-08-28.1", generatedAt: AT });
    const reversed = buildFullBundle([...surgeons].reverse(), { version: "2026-08-28.1", generatedAt: AT });
    expect(reversed.manifest.sha256).toBe(forward.manifest.sha256);
  });

  it("gzip does not stamp the clock into the header", () => {
    // Byte 4..8 of a gzip member is MTIME. A non-zero value here would make every rebuild differ.
    expect(Buffer.from(buildFullBundle(surgeons, { version: "2026-08-28.1", generatedAt: AT }).payload).subarray(4, 8)).toEqual(
      Buffer.from([0, 0, 0, 0]),
    );
  });
});

describe("signing and verifying", () => {
  const built = buildFullBundle(surgeons, { version: "2026-08-28.1", generatedAt: AT });
  const signed = signManifest(built.manifest, key);

  it("accepts a bundle signed by a known key whose payload matches", async () => {
    await expect(acceptBundle(signed, built.payload, verifier)).resolves.toMatchObject({ version: "2026-08-28.1" });
  });

  it("refuses a payload that does not match its manifest", async () => {
    const other = buildFullBundle(surgeons.slice(0, 10), { version: "2026-08-28.1", generatedAt: AT });
    await expect(acceptBundle(signed, other.payload, verifier)).rejects.toBeInstanceOf(BundleRejected);
  });

  it("refuses a manifest whose contents were edited after signing", async () => {
    const tampered = { ...signed, manifest: { ...signed.manifest, recordCount: 9999 } };
    await expect(acceptBundle(tampered, built.payload, verifier)).rejects.toThrow(/signature did not verify/);
  });

  it("refuses a key it does not know", async () => {
    const stranger = generateSigningKey("not-ours");
    const forged = signManifest(built.manifest, stranger);
    await expect(acceptBundle(forged, built.payload, verifier)).rejects.toThrow(/signature did not verify/);
  });

  it("refuses an unsigned manifest outright", async () => {
    const unsigned = { manifest: built.manifest } as never;
    await expect(acceptBundle(unsigned, built.payload, verifier)).rejects.toThrow(/did not parse/);
  });

  it("signs a stable byte sequence whatever order the manifest keys arrive in", () => {
    const shuffled = ManifestSchema.parse({
      basedOnVersion: built.manifest.basedOnVersion,
      sha256: built.manifest.sha256,
      version: built.manifest.version,
      recordCount: built.manifest.recordCount,
      generatedAt: built.manifest.generatedAt,
      channel: built.manifest.channel,
    });
    expect(canonicalManifestBytes(shuffled)).toEqual(canonicalManifestBytes(built.manifest));
  });
});

describe("the access-delta channel", () => {
  const rows = surgeons.slice(0, 12).map((s) => ({ ahpraId: s.ahpraId, access: s.access }));
  const delta = buildAccessDelta(rows, { version: "2026-08-29.1", generatedAt: AT, basedOnVersion: "2026-08-28.1" });

  it("is a few KB, not a re-download", () => {
    expect(delta.payload.byteLength).toBeLessThan(8 * 1024);
  });

  it("is independently signed and verifiable", async () => {
    await expect(acceptBundle(signManifest(delta.manifest, key), delta.payload, verifier)).resolves.toMatchObject({
      channel: "access-delta",
    });
  });

  it("names the full bundle it applies to", () => {
    expect(delta.manifest.basedOnVersion).toBe("2026-08-28.1");
  });

  it("refuses to exist without a base version", () => {
    expect(() =>
      ManifestSchema.parse({
        version: "2026-08-29.1", channel: "access-delta", generatedAt: AT,
        recordCount: 1, sha256: "a".repeat(64), basedOnVersion: null,
      }),
    ).toThrow();
  });

  it("a full bundle may not claim a base version", () => {
    expect(() =>
      ManifestSchema.parse({
        version: "2026-08-29.1", channel: "full", generatedAt: AT,
        recordCount: 1, sha256: "a".repeat(64), basedOnVersion: "2026-08-28.1",
      }),
    ).toThrow();
  });

  it("applies over a full bundle without re-downloading it", () => {
    const stale = surgeons.map((s) => ({ ...s, access: { ...s.access, booksOpen: { ...s.access.booksOpen, value: "unknown" as const } } }));
    const result = applyAccessDelta(stale, parseAccessDelta(delta.payload));
    expect(result.applied).toBe(12);
    expect(result.surgeons[0]?.access.booksOpen).toEqual(surgeons.find((s) => s.ahpraId === result.surgeons[0]?.ahpraId)?.access.booksOpen);
  });

  it("ignores a row for somebody the bundle has never heard of", () => {
    const result = applyAccessDelta(surgeons, [{ ahpraId: "MED9999999999", access: surgeons[0]!.access }]);
    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual(["MED9999999999"]);
    expect(result.surgeons).toHaveLength(50);
  });

  it("carries access only — identity never arrives on this channel", () => {
    const parsed = parseAccessDelta(delta.payload);
    expect(Object.keys(parsed[0]!).sort()).toEqual(["access", "ahpraId"]);
  });
});

describe("version retention", () => {
  const versions = Array.from({ length: 15 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}.1`);

  it("keeps the last twelve so any past ranking can be reproduced", () => {
    const { keep, drop } = pruneVersions(versions);
    expect(keep).toHaveLength(12);
    expect(drop).toEqual(["2026-08-01.1", "2026-08-02.1", "2026-08-03.1"]);
  });

  it("orders by date then serial, not lexically", () => {
    expect(compareVersions("2026-08-28.2", "2026-08-28.10")).toBeLessThan(0);
    expect(compareVersions("2026-08-28.1", "2026-08-29.1")).toBeLessThan(0);
  });
});

describe("hashing", () => {
  it("is sha-256 over the payload bytes", () => {
    expect(sha256Hex(new Uint8Array([]))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
