// The one screen, and what it is allowed to write.
//
// A specialist gives this thirty seconds a month at most. Payer toggles, books open, two wait
// ranges, and a confirm-all button for the common case where nothing has changed — confirming an
// unchanged fact is the single most valuable action on the page, because a fact re-dated today is
// worth more to the matcher than the same fact going stale.
//
// EVERYTHING WRITTEN HERE IS TIER S. That is not a downgrade, it is a description: the practice
// told us. Payer acceptance is trusted at that tier — they know who they bill. Wait times are
// stored exactly as reported and still discounted by the matcher, because rooms consistently
// understate and the tier is what tells the matcher to discount.

import {
  ACCESS_FIELD_KEYS,
  PAYER_KEYS,
  type AccessField,
  type AccessFieldKey,
  type AccessRecord,
  type Tri,
} from "@referral/core";
import { z } from "zod";

/** Wait ranges rather than a number: nobody knows their wait to the day, and a range is honest. */
export const WAIT_BANDS = [
  { key: "under-2-weeks", days: 10, label: "Under 2 weeks" },
  { key: "2-4-weeks", days: 21, label: "2 to 4 weeks" },
  { key: "1-2-months", days: 45, label: "1 to 2 months" },
  { key: "2-3-months", days: 75, label: "2 to 3 months" },
  { key: "3-6-months", days: 135, label: "3 to 6 months" },
  { key: "over-6-months", days: 210, label: "More than 6 months" },
] as const;
export const WaitBandSchema = z.enum(WAIT_BANDS.map((b) => b.key) as [string, ...string[]]);

export function daysForBand(band: string): number | null {
  return WAIT_BANDS.find((b) => b.key === band)?.days ?? null;
}

const TriInput = z.union([z.boolean(), z.literal("unknown")]);

export const SubmissionSchema = z
  .object({
    ahpraId: z.string(),
    workcover: TriInput.optional(),
    tac: TriInput.optional(),
    ctp: TriInput.optional(),
    dva: TriInput.optional(),
    comcare: TriInput.optional(),
    noGapFunds: z.array(z.string()).optional(),
    bulkBillsInitial: TriInput.optional(),
    booksOpen: TriInput.optional(),
    waitToConsultBand: WaitBandSchema.optional(),
    waitToSurgeryBand: WaitBandSchema.optional(),
    /**
     * The confirm-all button. Re-dates every field the practice did not change, which is the
     * whole point of the screen — a fact confirmed today outranks the same fact going stale.
     */
    confirmUnchanged: z.boolean(),
  })
  .strict();
export type Submission = z.infer<typeof SubmissionSchema>;

function tierS<T>(value: T | "unknown", at: string): AccessField<T> {
  return { value, tier: "S", source: "portal", confirmedAt: at };
}

/**
 * Apply a submission to the access record the portal holds for that specialist.
 *
 * A field the practice left alone is re-dated only when they pressed confirm-all, and only if it
 * already came from them. A phone-verified or fund-directory fact is never quietly restamped as
 * self-reported — that would launder a tier A fact down to tier S and lose the better provenance.
 */
export function applySubmission(held: AccessRecord, submission: Submission, at: string): AccessRecord {
  const next: Record<string, AccessField<unknown>> = { ...held };

  const set = (key: AccessFieldKey, value: unknown) => {
    next[key] = tierS(value as never, at);
  };

  for (const payer of PAYER_KEYS) {
    const value = submission[payer];
    if (value !== undefined) set(payer, value as Tri);
  }
  if (submission.noGapFunds !== undefined) set("noGapFunds", submission.noGapFunds);
  if (submission.bulkBillsInitial !== undefined) set("bulkBillsInitial", submission.bulkBillsInitial);
  if (submission.booksOpen !== undefined) set("booksOpen", submission.booksOpen);
  if (submission.waitToConsultBand !== undefined) set("waitToConsultDays", daysForBand(submission.waitToConsultBand));
  if (submission.waitToSurgeryBand !== undefined) set("waitToSurgeryDays", daysForBand(submission.waitToSurgeryBand));

  if (submission.confirmUnchanged) {
    for (const key of ACCESS_FIELD_KEYS) {
      const field = next[key]!;
      if (field.confirmedAt === at) continue;
      if (field.tier !== "S") continue;
      next[key] = { ...field, confirmedAt: at };
    }
  }

  return next as AccessRecord;
}
