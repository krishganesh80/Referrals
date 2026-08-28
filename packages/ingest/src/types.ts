// The adapter contract. Every identity source implements exactly this, so a licensed AOA feed
// can later replace several scrapers without the matcher, the schema or the client knowing.
//
// ONE PROPERTY WORTH NAMING. `PartialSurgeon` carries no tier field. An adapter states what it
// found and where it found it; the runner stamps the tier from the adapter's own `defaultTier`.
// A source therefore cannot claim evidence stronger than its class allows — a practice-website
// scraper cannot emit a tier A tag even by mistake, because there is no field for it to write.

import { AhpraIdSchema, SubspecialtySchema, PracticeLocationSchema, IsoDateSchema } from "@referral/core";
import { z } from "zod";

/**
 * `blocked` and `needs-review` both refuse to run. They are distinct so the register says which
 * sources were checked and rejected, and which were never checked at all.
 */
export const LegalStatusSchema = z.enum(["cleared", "needs-review", "blocked"]);
export type LegalStatus = z.infer<typeof LegalStatusSchema>;

/** Identity adapters never produce tier S — that tier means the practice told us directly. */
export const IdentityTierSchema = z.enum(["A", "B", "C"]);
export type IdentityTier = z.infer<typeof IdentityTierSchema>;

export const RawSnapshotSchema = z
  .object({
    adapterId: z.string().min(1),
    fetchedAt: z.string().min(1),
    url: z.union([z.string(), z.null()]),
    contentHash: z.string().min(1),
    body: z.string(),
  })
  .strict();
export type RawSnapshot = z.infer<typeof RawSnapshotSchema>;

/** A tag as an adapter reports it: the bucket and the evidence sentence, never the tier. */
export const PartialTagSchema = z
  .object({ bucket: SubspecialtySchema, evidence: z.string().min(1) })
  .strict();
export type PartialTag = z.infer<typeof PartialTagSchema>;

export const PartialSurgeonSchema = z
  .object({
    /** Null where the source does not publish it — those records go to review, never auto-merge. */
    ahpraId: z.union([AhpraIdSchema, z.null()]),
    familyName: z.string().min(1),
    givenNames: z.string().min(1),
    /** Used only to disambiguate a fuzzy name match. Never treated as a practice location. */
    postcodeHint: z.union([z.string().regex(/^\d{4}$/), z.null()]),
    specialistRegistrationSince: z.union([IsoDateSchema, z.null()]),
    tags: z.array(PartialTagSchema),
    locations: z.array(PracticeLocationSchema),
    languages: z.array(z.string()),
    telehealth: z.union([z.boolean(), z.null()]),
  })
  .strict();
export type PartialSurgeon = z.infer<typeof PartialSurgeonSchema>;

export interface SourceAdapter {
  readonly id: string;
  readonly legalStatus: LegalStatus;
  readonly defaultTier: IdentityTier;
  /** One-line statement of what this source is and under what terms, shown in the register. */
  readonly description: string;
  fetch(): Promise<RawSnapshot>;
  parse(snapshot: RawSnapshot): Promise<PartialSurgeon[]>;
}

export class AdapterNotClearedError extends Error {
  constructor(
    readonly adapterId: string,
    readonly legalStatus: LegalStatus,
  ) {
    super(
      `adapter '${adapterId}' has legalStatus '${legalStatus}' and will not be run. ` +
        `Terms of use must be checked and the status flipped to 'cleared' by a human first.`,
    );
    this.name = "AdapterNotClearedError";
  }
}

export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt disallows fetching ${url}`);
    this.name = "RobotsDisallowedError";
  }
}
