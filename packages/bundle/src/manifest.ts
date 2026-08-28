// The bundle manifest and its signature.
//
// The client refuses a bundle it cannot verify, so the manifest is the trust boundary of the
// whole product: everything a GP sees came from a payload whose hash this manifest names and
// whose manifest our key signed.
//
// SIGNING HAPPENS ON OUR MACHINES; VERIFYING HAPPENS IN A BROWSER. Those are different crypto
// APIs — node:crypto one side, WebCrypto the other — so verification takes an injected verifier
// rather than importing node:crypto and quietly failing to load in the client.

import { z } from "zod";

export const BUNDLE_CHANNELS = ["full", "access-delta"] as const;
export const ChannelSchema = z.enum(BUNDLE_CHANNELS);
export type Channel = z.infer<typeof ChannelSchema>;

export const ManifestSchema = z
  .object({
    /** Monotonic and immutable. A version is never rebuilt with different content. */
    version: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/, "expected YYYY-MM-DD.N"),
    channel: ChannelSchema,
    generatedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "not a real timestamp"),
    recordCount: z.number().int().nonnegative(),
    /** SHA-256 of the gzipped payload, lowercase hex. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /**
     * For a delta: the full bundle version it applies to. A delta that names no base could be
     * applied to anything, which is how a client ends up with a record built from two eras.
     */
    basedOnVersion: z.union([z.string(), z.null()]),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.channel === "access-delta" && manifest.basedOnVersion === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an access-delta must name the full bundle version it applies to",
        path: ["basedOnVersion"],
      });
    }
    if (manifest.channel === "full" && manifest.basedOnVersion !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a full bundle is not based on anything",
        path: ["basedOnVersion"],
      });
    }
  });
export type Manifest = z.infer<typeof ManifestSchema>;

export const SignedManifestSchema = z
  .object({
    manifest: ManifestSchema,
    /** Ed25519 signature over the canonical JSON of `manifest`, base64. */
    signature: z.string().min(1),
    keyId: z.string().min(1),
  })
  .strict();
export type SignedManifest = z.infer<typeof SignedManifestSchema>;

/**
 * The exact bytes that get signed. Key order is fixed here rather than left to JSON.stringify's
 * insertion order, so a manifest that round-trips through a database still verifies.
 */
export function canonicalManifestBytes(manifest: Manifest): Uint8Array {
  const ordered = {
    basedOnVersion: manifest.basedOnVersion,
    channel: manifest.channel,
    generatedAt: manifest.generatedAt,
    recordCount: manifest.recordCount,
    sha256: manifest.sha256,
    version: manifest.version,
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

/** Verification is injected so the same module runs in node and in the browser. */
export interface SignatureVerifier {
  (message: Uint8Array, signatureBase64: string, keyId: string): boolean | Promise<boolean>;
}

export class BundleRejected extends Error {
  constructor(readonly reason: string) {
    super(`bundle rejected: ${reason}`);
    this.name = "BundleRejected";
  }
}
