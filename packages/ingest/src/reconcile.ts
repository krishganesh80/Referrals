// Merging what the sources said into what we already hold.
//
// Three rules, and all three are about refusing to be clever:
//
//   AHPRA ID OR NOTHING. A record merges only on an exact AHPRA match. A name-and-postcode
//   resemblance produces a REVIEW ITEM, never a merge. Two orthopaedic surgeons sharing a
//   surname in the same suburb is not a rare event, and a wrong merge is close to unrecoverable
//   once the merged record has been through a verification call.
//
//   NOTHING IS SILENTLY DISCARDED. Where two sources disagree, the existing value stands, the
//   incoming one is kept alongside it with its source, and the disagreement goes to review.
//   Overwriting would make the newest scrape authoritative purely by being last.
//
//   TIER C NEVER AUTO-PROMOTES. A practice website generates candidate tags for a human to
//   accept. They do not touch the record on the way past.

import {
  SurgeonSchema,
  unknownAccessRecord,
  type EvidenceTier,
  type SubspecialtyTag,
  type Surgeon,
} from "@referral/core";
import type { IncomingRecord } from "./runner";
import type { PartialSurgeon } from "./types";

export interface FieldConflict {
  readonly ahpraId: string;
  readonly field: "familyName" | "givenNames" | "specialistRegistrationSince" | "telehealth";
  readonly held: string;
  readonly incoming: string;
  readonly adapterId: string;
}

export type ReviewItem =
  | { readonly kind: "fuzzy-match"; readonly adapterId: string; readonly partial: PartialSurgeon; readonly candidateAhpraId: string; readonly basis: string }
  | { readonly kind: "unidentified"; readonly adapterId: string; readonly partial: PartialSurgeon }
  | { readonly kind: "conflict"; readonly conflict: FieldConflict }
  | { readonly kind: "tag-candidate"; readonly adapterId: string; readonly ahpraId: string; readonly tag: SubspecialtyTag };

export interface ReconcileResult {
  readonly surgeons: readonly Surgeon[];
  readonly review: readonly ReviewItem[];
}

export interface ReconcileOptions {
  /** The day this run happened; stamped on the access record of any newly created surgeon. */
  readonly today: string;
}

const TIER_RANK: Readonly<Record<EvidenceTier, number>> = { A: 3, B: 2, S: 1, C: 0 };

export function normaliseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * Candidates for a record that arrived without an AHPRA id. Deliberately generous — it is
 * feeding a human review queue, not a merge, so a false candidate costs a glance and a missed
 * one costs a duplicate record.
 */
export function fuzzyCandidates(
  partial: PartialSurgeon,
  existing: readonly Surgeon[],
): ReadonlyArray<{ ahpraId: string; basis: string }> {
  const family = normaliseName(partial.familyName);
  const initial = normaliseName(partial.givenNames).charAt(0);
  const found: Array<{ ahpraId: string; basis: string }> = [];
  for (const surgeon of existing) {
    if (normaliseName(surgeon.familyName) !== family) continue;
    const sameInitial = normaliseName(surgeon.givenNames).charAt(0) === initial;
    const samePostcode =
      partial.postcodeHint !== null &&
      surgeon.locations.some((l) => l.postcode === partial.postcodeHint);
    if (!sameInitial && !samePostcode) continue;
    found.push({
      ahpraId: surgeon.ahpraId,
      basis: [
        "family name matches",
        sameInitial ? "given initial matches" : null,
        samePostcode ? `postcode ${partial.postcodeHint} matches a listed location` : null,
      ]
        .filter(Boolean)
        .join("; "),
    });
  }
  return found;
}

function mergeTags(
  held: readonly SubspecialtyTag[],
  incoming: readonly SubspecialtyTag[],
): SubspecialtyTag[] {
  const byBucket = new Map<string, SubspecialtyTag>();
  for (const tag of held) byBucket.set(tag.bucket, tag);
  for (const tag of incoming) {
    const existing = byBucket.get(tag.bucket);
    if (!existing) {
      byBucket.set(tag.bucket, tag);
      continue;
    }
    // The stronger evidence wins the slot; the weaker one's source id is kept, so the record
    // still shows that a second source agreed.
    const winner = TIER_RANK[tag.tier] > TIER_RANK[existing.tier] ? tag : existing;
    const other = winner === tag ? existing : tag;
    byBucket.set(tag.bucket, {
      ...winner,
      sourceRecordIds: [...new Set([...winner.sourceRecordIds, ...other.sourceRecordIds])],
    });
  }
  return [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function newSurgeon(record: IncomingRecord, today: string): Surgeon {
  const { partial } = record;
  return SurgeonSchema.parse({
    ahpraId: partial.ahpraId,
    familyName: partial.familyName,
    givenNames: partial.givenNames,
    preferredName: null,
    specialistRegistration: {
      specialty: "Orthopaedic surgery",
      since: partial.specialistRegistrationSince ?? today,
    },
    disciplineOfOrigin: "orthopaedic",
    subspecialtyTags: [],
    locations: partial.locations,
    languages: partial.languages,
    telehealth: partial.telehealth ?? false,
    // Identity sources say who somebody is, never who they accept.
    access: unknownAccessRecord(today),
    referralWeight: 0,
    sourceRecords: [record.sourceRecord],
    lastReviewedAt: null,
  });
}

export function reconcile(
  existing: readonly Surgeon[],
  incoming: readonly IncomingRecord[],
  options: ReconcileOptions,
): ReconcileResult {
  const byId = new Map<string, Surgeon>(existing.map((s) => [s.ahpraId, s]));
  const review: ReviewItem[] = [];

  for (const record of incoming) {
    const { partial, adapterId, tier, sourceRecord } = record;

    if (partial.ahpraId === null) {
      const candidates = fuzzyCandidates(partial, [...byId.values()]);
      if (candidates.length === 0) {
        review.push({ kind: "unidentified", adapterId, partial });
      } else {
        for (const candidate of candidates) {
          review.push({
            kind: "fuzzy-match",
            adapterId,
            partial,
            candidateAhpraId: candidate.ahpraId,
            basis: candidate.basis,
          });
        }
      }
      continue;
    }

    const incomingTags: SubspecialtyTag[] = partial.tags.map((t) => ({
      bucket: t.bucket,
      tier,
      evidence: t.evidence,
      sourceRecordIds: [sourceRecord.id],
    }));

    const held = byId.get(partial.ahpraId);
    if (!held) {
      const created = newSurgeon(record, options.today);
      // Even on a brand-new record, tier C is a candidate rather than a fact.
      const promotable = incomingTags.filter((t) => t.tier !== "C");
      for (const tag of incomingTags.filter((t) => t.tier === "C")) {
        review.push({ kind: "tag-candidate", adapterId, ahpraId: created.ahpraId, tag });
      }
      byId.set(created.ahpraId, { ...created, subspecialtyTags: mergeTags([], promotable) });
      continue;
    }

    const conflicts: FieldConflict[] = [];
    const note = (field: FieldConflict["field"], heldValue: string, incomingValue: string) => {
      if (heldValue !== incomingValue) {
        conflicts.push({ ahpraId: partial.ahpraId!, field, held: heldValue, incoming: incomingValue, adapterId });
      }
    };
    note("familyName", held.familyName, partial.familyName);
    note("givenNames", held.givenNames, partial.givenNames);
    if (partial.specialistRegistrationSince !== null) {
      note("specialistRegistrationSince", held.specialistRegistration.since, partial.specialistRegistrationSince);
    }
    if (partial.telehealth !== null) {
      note("telehealth", String(held.telehealth), String(partial.telehealth));
    }
    for (const conflict of conflicts) review.push({ kind: "conflict", conflict });

    for (const tag of incomingTags.filter((t) => t.tier === "C")) {
      review.push({ kind: "tag-candidate", adapterId, ahpraId: held.ahpraId, tag });
    }

    const knownLocationIds = new Set(held.locations.map((l) => l.id));
    byId.set(held.ahpraId, {
      ...held,
      // The held value stands. The incoming one is in the review queue, not thrown away.
      subspecialtyTags: mergeTags(held.subspecialtyTags, incomingTags.filter((t) => t.tier !== "C")),
      locations: [...held.locations, ...partial.locations.filter((l) => !knownLocationIds.has(l.id))],
      languages: [...new Set([...held.languages, ...partial.languages])],
      sourceRecords: held.sourceRecords.some((r) => r.id === sourceRecord.id)
        ? held.sourceRecords
        : [...held.sourceRecords, sourceRecord],
    });
  }

  return {
    surgeons: [...byId.values()].sort((a, b) => a.ahpraId.localeCompare(b.ahpraId)),
    review,
  };
}
