// The canonical record shapes. Zod is the source of truth; every exported type is inferred
// from a schema so the two cannot drift.
//
// Three rules are enforced here rather than by convention, because each one is the kind of
// thing that erodes quietly:
//
//   EVERY OBJECT IS `.strict()`. Staleness is derived and must never be stored, so a record
//   carrying a `staleness` key fails to parse rather than being silently ignored. The same
//   applies to any commercial field: a `sponsored` or `boost` key cannot enter the schema by
//   accident because it cannot enter a record at all.
//
//   `'unknown'` IS A VALUE, NOT AN ABSENCE. No `AccessField.value` accepts `null` or
//   `undefined`. A record that means "we have not confirmed this" must say so in the value.
//
//   TIER `S` MEANS THE PRACTICE TOLD US. It is refined against the source, so a field cannot
//   claim self-reported provenance while naming a source that is not the portal, or vice
//   versa. Provenance that contradicts itself is worse than provenance that is missing.

import { z } from "zod";

/** YYYY-MM-DD, and a date that actually exists. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`)), "not a real date");
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** ISO 8601 instant, used for fetch timestamps where the time of day matters. */
export const IsoInstantSchema = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "not a real timestamp");

/**
 * AHPRA registration number — the canonical key. Medical practitioners carry the `MED`
 * prefix; the prefix is kept general so a future non-medical entry does not need a schema
 * change to be represented (it would still need a deliberate decision to be ingested).
 */
export const AhpraIdSchema = z.string().regex(/^[A-Z]{3}\d{10}$/, "expected e.g. MED0001234567");
export type AhpraId = z.infer<typeof AhpraIdSchema>;

// ---------------------------------------------------------------------------
// Provenance tiers
// ---------------------------------------------------------------------------

/**
 * A — verified registry or sub-specialty society membership. Hard signal.
 * B — derived from publication record, hospital credentialing, or booking-platform availability.
 * C — self-described on a practice website. Weak.
 * S — self-reported by the practice through our portal.
 */
export const EvidenceTierSchema = z.enum(["A", "B", "C", "S"]);
export type EvidenceTier = z.infer<typeof EvidenceTierSchema>;

/**
 * Access data has no tier C. Nothing on a practice website is taken as a statement about who
 * a surgeon currently accepts or how long the wait is — that claim needs a channel that dates
 * itself. The absence of C here is deliberate and load-bearing.
 */
export const AccessTierSchema = z.enum(["A", "B", "S"]);
export type AccessTier = z.infer<typeof AccessTierSchema>;

export const AccessSourceSchema = z.enum([
  "phone",
  "portal",
  "booking-platform",
  "insurer-directory",
  "state-health",
]);
export type AccessSource = z.infer<typeof AccessSourceSchema>;

// ---------------------------------------------------------------------------
// Tri and AccessField
// ---------------------------------------------------------------------------

export const TriSchema = z.union([z.boolean(), z.literal("unknown")]);
export type Tri = z.infer<typeof TriSchema>;

/**
 * One independently sourced, independently dated fact about access.
 *
 * `staleness` is absent by design — it is a function of `confirmedAt` and the field's own
 * half-life, computed at read time by `freshness()`. Storing it would let a record disagree
 * with the clock.
 */
export interface AccessField<T> {
  readonly value: T | "unknown";
  readonly tier: AccessTier;
  readonly source: AccessSource;
  readonly confirmedAt: IsoDate;
}

const TIER_S_SOURCE = "portal" as const;

export function accessFieldSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .object({
      value: z.union([valueSchema, z.literal("unknown")]),
      tier: AccessTierSchema,
      source: AccessSourceSchema,
      confirmedAt: IsoDateSchema,
    })
    .strict()
    .superRefine((field, ctx) => {
      if (field.tier === "S" && field.source !== TIER_S_SOURCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tier S means the practice told us through the portal, but source is '${field.source}'`,
          path: ["tier"],
        });
      }
      if (field.source === TIER_S_SOURCE && field.tier !== "S") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `source 'portal' is self-reported and must carry tier S, not '${field.tier}'`,
          path: ["tier"],
        });
      }
    });
}

/**
 * Self-reported is a property of the tier, not a separate stored flag. A stored flag could
 * disagree with the tier; a derived one cannot. The matcher discounts on this predicate.
 */
export function isSelfReported(field: AccessField<unknown>): boolean {
  return field.tier === "S";
}

const TriField = accessFieldSchema(TriSchema);
const DaysField = accessFieldSchema(z.number().int().nonnegative());
const FundsField = accessFieldSchema(z.array(z.string()));

// ---------------------------------------------------------------------------
// AccessRecord
// ---------------------------------------------------------------------------

export const AccessRecordSchema = z
  .object({
    workcover: TriField,
    tac: TriField,
    ctp: TriField,
    dva: TriField,
    comcare: TriField,
    noGapFunds: FundsField,
    bulkBillsInitial: TriField,
    booksOpen: TriField,
    waitToConsultDays: DaysField,
    waitToSurgeryDays: DaysField,
  })
  .strict();
export type AccessRecord = z.infer<typeof AccessRecordSchema>;

/** Every access field, in a fixed order. Iterated by the freshness table and the call CLI. */
export const ACCESS_FIELD_KEYS = [
  "workcover",
  "tac",
  "ctp",
  "dva",
  "comcare",
  "noGapFunds",
  "bulkBillsInitial",
  "booksOpen",
  "waitToConsultDays",
  "waitToSurgeryDays",
] as const;
export type AccessFieldKey = (typeof ACCESS_FIELD_KEYS)[number];

/** The five payer fields a GP can filter on. */
export const PAYER_KEYS = ["workcover", "tac", "ctp", "dva", "comcare"] as const;
export const PayerKeySchema = z.enum(PAYER_KEYS);
export type PayerKey = z.infer<typeof PayerKeySchema>;

/** Display names, so no call site invents its own wording for a payer. */
export const PAYER_COPY: Readonly<Record<PayerKey, string>> = {
  workcover: "WorkCover",
  tac: "TAC",
  ctp: "CTP",
  dva: "DVA",
  comcare: "Comcare",
};

export const ACCESS_FIELD_COPY: Readonly<Record<AccessFieldKey, string>> = {
  ...PAYER_COPY,
  noGapFunds: "No-gap funds",
  bulkBillsInitial: "Bulk bills initial consult",
  booksOpen: "Books open",
  waitToConsultDays: "Wait to consult",
  waitToSurgeryDays: "Wait to surgery",
};

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export const AuStateSchema = z.enum(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
export type AuState = z.infer<typeof AuStateSchema>;

/**
 * Published public waiting times describe a hospital department, not a person. They hang off
 * the location for exactly that reason, and the matcher is forbidden from folding them into a
 * surgeon's own wait score — see `matcher.ts`. They surface as a stated fact about the public
 * pathway at that hospital and nothing more.
 */
export const DepartmentWaitSchema = z
  .object({
    waitToConsultDays: DaysField,
    waitToSurgeryDays: DaysField,
  })
  .strict();
export type DepartmentWait = z.infer<typeof DepartmentWaitSchema>;

export const PracticeLocationSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["rooms", "operating"]),
    name: z.string().min(1),
    address: z.string(),
    suburb: z.string(),
    state: AuStateSchema,
    postcode: z.string().regex(/^\d{4}$/),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    sector: z.enum(["public", "private"]),
    departmentWait: z.union([DepartmentWaitSchema, z.null()]),
  })
  .strict()
  .superRefine((loc, ctx) => {
    if (loc.departmentWait !== null && loc.sector !== "public") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "published department waiting times describe a public clinic; a private location cannot carry one",
        path: ["departmentWait"],
      });
    }
  });
export type PracticeLocation = z.infer<typeof PracticeLocationSchema>;

// ---------------------------------------------------------------------------
// Subspecialty tags and source records
// ---------------------------------------------------------------------------

export const SUBSPECIALTIES = [
  "hip_knee_arthroplasty",
  "knee_sports",
  "shoulder_elbow",
  "hand_wrist",
  "foot_ankle",
  "spine",
  "paediatric",
  "trauma_limb_recon",
  "tumour",
] as const;
export const SubspecialtySchema = z.enum(SUBSPECIALTIES);
export type Subspecialty = z.infer<typeof SubspecialtySchema>;

export const SUBSPECIALTY_COPY: Readonly<Record<Subspecialty, string>> = {
  hip_knee_arthroplasty: "Hip & knee arthroplasty",
  knee_sports: "Knee — sports & ligament",
  shoulder_elbow: "Shoulder & elbow",
  hand_wrist: "Hand & wrist",
  foot_ankle: "Foot & ankle",
  spine: "Spine",
  paediatric: "Paediatric",
  trauma_limb_recon: "Trauma & limb reconstruction",
  tumour: "Tumour",
};

export const SubspecialtyTagSchema = z
  .object({
    bucket: SubspecialtySchema,
    tier: EvidenceTierSchema,
    evidence: z.string().min(1),
    sourceRecordIds: z.array(z.string()),
  })
  .strict();
export type SubspecialtyTag = z.infer<typeof SubspecialtyTagSchema>;

export const SourceRecordSchema = z
  .object({
    id: z.string().min(1),
    adapterId: z.string().min(1),
    fetchedAt: IsoInstantSchema,
    url: z.union([z.string(), z.null()]),
    snapshotHash: z.string(),
  })
  .strict();
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

// ---------------------------------------------------------------------------
// Surgeon
// ---------------------------------------------------------------------------

/**
 * Spine is shared with neurosurgery. Phase one ingests orthopaedic surgeons only, but the
 * discipline is on the record from the first day so adding neurosurgeons later is data, not
 * a migration.
 */
export const DisciplineSchema = z.enum(["orthopaedic", "neurosurgical"]);
export type Discipline = z.infer<typeof DisciplineSchema>;

export const SurgeonSchema = z
  .object({
    ahpraId: AhpraIdSchema,
    familyName: z.string().min(1),
    givenNames: z.string().min(1),
    preferredName: z.union([z.string(), z.null()]),
    specialistRegistration: z
      .object({ specialty: z.string().min(1), since: IsoDateSchema })
      .strict(),
    disciplineOfOrigin: DisciplineSchema,
    subspecialtyTags: z.array(SubspecialtyTagSchema),
    locations: z.array(PracticeLocationSchema),
    languages: z.array(z.string()),
    telehealth: z.boolean(),
    access: AccessRecordSchema,
    referralWeight: z.number().min(0).max(1),
    sourceRecords: z.array(SourceRecordSchema),
    lastReviewedAt: z.union([IsoDateSchema, z.null()]),
  })
  .strict();
export type Surgeon = z.infer<typeof SurgeonSchema>;

export function displayName(surgeon: Surgeon): string {
  const given = surgeon.preferredName ?? surgeon.givenNames.split(" ")[0] ?? surgeon.givenNames;
  return `${given} ${surgeon.familyName}`;
}
