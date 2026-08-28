// Building, signing, verifying and applying a bundle.
//
// ~1,500 surgeons nationally, so this is deliberately not clever: newline-delimited JSON,
// gzipped, well under a megabyte. Optimised for being readable in a terminal when something is
// wrong, not for bytes.

import { createHash, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { AccessRecordSchema, SurgeonSchema, type AccessRecord, type Surgeon } from "@referral/core";
import { z } from "zod";
import {
  BundleRejected,
  ManifestSchema,
  SignedManifestSchema,
  canonicalManifestBytes,
  type Channel,
  type Manifest,
  type SignatureVerifier,
  type SignedManifest,
} from "./manifest";

export interface BuiltBundle {
  readonly manifest: Manifest;
  readonly payload: Uint8Array;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Node's gzip writes a zeroed MTIME field rather than the current time, so identical content
 * compresses to identical bytes. That is what lets a past ranking be reproduced from a past
 * version, so it is pinned by a test rather than left as an assumption about the runtime.
 */
function deterministicGzip(text: string): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(text, "utf8"), { level: 9 }));
}

function toNdjson(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");
}

// ---------------------------------------------------------------------------
// Full channel
// ---------------------------------------------------------------------------

export function buildFullBundle(
  surgeons: readonly Surgeon[],
  options: { version: string; generatedAt: string },
): BuiltBundle {
  // Sorted so the payload is a function of the content alone, never of the caller's ordering.
  const sorted = [...surgeons].sort((a, b) => a.ahpraId.localeCompare(b.ahpraId));
  const payload = deterministicGzip(toNdjson(sorted));
  const manifest = ManifestSchema.parse({
    version: options.version,
    channel: "full" satisfies Channel,
    generatedAt: options.generatedAt,
    recordCount: sorted.length,
    sha256: sha256Hex(payload),
    basedOnVersion: null,
  });
  return { manifest, payload };
}

export function parseFullBundle(payload: Uint8Array): Surgeon[] {
  const text = gunzipSync(Buffer.from(payload)).toString("utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => SurgeonSchema.parse(JSON.parse(line)));
}

// ---------------------------------------------------------------------------
// Access-delta channel
// ---------------------------------------------------------------------------

export const AccessDeltaRowSchema = z
  .object({ ahpraId: z.string(), access: AccessRecordSchema })
  .strict();
export type AccessDeltaRow = z.infer<typeof AccessDeltaRowSchema>;

/**
 * Only the fields that move daily. A few KB, independently signed, applicable without
 * re-downloading the full bundle.
 */
export function buildAccessDelta(
  rows: readonly AccessDeltaRow[],
  options: { version: string; generatedAt: string; basedOnVersion: string },
): BuiltBundle {
  const sorted = [...rows].sort((a, b) => a.ahpraId.localeCompare(b.ahpraId));
  const payload = deterministicGzip(toNdjson(sorted));
  const manifest = ManifestSchema.parse({
    version: options.version,
    channel: "access-delta" satisfies Channel,
    generatedAt: options.generatedAt,
    recordCount: sorted.length,
    sha256: sha256Hex(payload),
    basedOnVersion: options.basedOnVersion,
  });
  return { manifest, payload };
}

export function parseAccessDelta(payload: Uint8Array): AccessDeltaRow[] {
  const text = gunzipSync(Buffer.from(payload)).toString("utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => AccessDeltaRowSchema.parse(JSON.parse(line)));
}

/**
 * Apply a delta to a set of surgeons. A row for somebody not in the bundle is ignored rather
 * than inserted: a delta carries access facts, and a record with access but no identity is not
 * a surgeon. Identity only ever arrives on the full channel.
 */
export function applyAccessDelta(
  surgeons: readonly Surgeon[],
  rows: readonly AccessDeltaRow[],
): { surgeons: Surgeon[]; applied: number; skipped: string[] } {
  const byId = new Map<string, AccessRecord>(rows.map((r) => [r.ahpraId, r.access]));
  const known = new Set(surgeons.map((s) => s.ahpraId));
  const skipped = rows.map((r) => r.ahpraId).filter((id) => !known.has(id));
  let applied = 0;
  const updated = surgeons.map((surgeon) => {
    const access = byId.get(surgeon.ahpraId);
    if (!access) return surgeon;
    applied += 1;
    return { ...surgeon, access };
  });
  return { surgeons: updated, applied, skipped };
}

// ---------------------------------------------------------------------------
// Signing and verifying
// ---------------------------------------------------------------------------

export interface KeyPair {
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
}

export function generateSigningKey(keyId: string): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    keyId,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export function signManifest(manifest: Manifest, key: KeyPair): SignedManifest {
  const signature = nodeSign(null, canonicalManifestBytes(manifest), key.privateKeyPem);
  return SignedManifestSchema.parse({
    manifest,
    signature: signature.toString("base64"),
    keyId: key.keyId,
  });
}

/** A verifier backed by node:crypto, for tests and for anything running server-side. */
export function nodeVerifier(publicKeysByKeyId: Readonly<Record<string, string>>): SignatureVerifier {
  return (message, signatureBase64, keyId) => {
    const publicKeyPem = publicKeysByKeyId[keyId];
    if (publicKeyPem === undefined) return false;
    try {
      return nodeVerify(null, message, publicKeyPem, Buffer.from(signatureBase64, "base64"));
    } catch {
      return false;
    }
  };
}

/**
 * The client's entry point. Refuses an unsigned bundle, a bundle signed by a key it does not
 * know, and a payload whose hash does not match the manifest it was delivered with.
 */
export async function acceptBundle(
  signed: SignedManifest,
  payload: Uint8Array,
  verifier: SignatureVerifier,
): Promise<Manifest> {
  const parsed = SignedManifestSchema.safeParse(signed);
  if (!parsed.success) throw new BundleRejected("manifest did not parse");

  const ok = await verifier(canonicalManifestBytes(parsed.data.manifest), parsed.data.signature, parsed.data.keyId);
  if (!ok) throw new BundleRejected("signature did not verify");

  if (sha256Hex(payload) !== parsed.data.manifest.sha256) {
    throw new BundleRejected("payload hash does not match the manifest");
  }
  return parsed.data.manifest;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export const VERSIONS_KEPT = 12;

/**
 * Which versions to keep so any past ranking can be reproduced, and which to drop. Bundles are
 * immutable: a version is never rebuilt, only superseded.
 */
export function pruneVersions(versions: readonly string[], keep: number = VERSIONS_KEPT) {
  const sorted = [...new Set(versions)].sort(compareVersions);
  return { keep: sorted.slice(-keep), drop: sorted.slice(0, Math.max(0, sorted.length - keep)) };
}

export function compareVersions(a: string, b: string): number {
  const [dateA = "", serialA = "0"] = a.split(".");
  const [dateB = "", serialB = "0"] = b.split(".");
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  return Number(serialA) - Number(serialB);
}
