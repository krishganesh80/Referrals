// Who cleared which source, when, and on what basis.
//
// Adapters still SHIP as 'needs-review'. Clearance is applied on top, from a committed register,
// for three reasons that hardcoding `legalStatus: 'cleared'` into an adapter would lose:
//
//   IT SAYS WHO. A legal decision with no name attached is not a decision anybody can stand
//   behind later. The register records the person and the date.
//
//   IT IS REVOCABLE. Removing a line un-clears a source. Editing a constant in an adapter and
//   hoping the change is noticed is not the same thing.
//
//   IT IS PER SOURCE. A blanket "clear everything" cannot be expressed here. Each entry names one
//   adapter id, so a source that did not exist when clearance was given does not inherit it —
//   which is exactly the case for a hospital or practice site added next month.

import { z } from "zod";
import { IsoDateSchema } from "@referral/core";
import { LegalStatusSchema, type LegalStatus, type SourceAdapter } from "./types";

export const ClearanceEntrySchema = z
  .object({
    adapterId: z.string().min(1),
    status: LegalStatusSchema,
    clearedBy: z.string().min(1),
    clearedAt: IsoDateSchema,
    /** Why this source may be fetched. Read by a human reviewing the register later. */
    basis: z.string().min(10),
  })
  .strict();
export type ClearanceEntry = z.infer<typeof ClearanceEntrySchema>;

export const ClearanceRegisterSchema = z
  .object({
    version: z.literal(1),
    clearances: z.array(ClearanceEntrySchema),
  })
  .strict()
  .superRefine((register, ctx) => {
    const seen = new Set<string>();
    for (const entry of register.clearances) {
      if (seen.has(entry.adapterId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate clearance for '${entry.adapterId}' — one source, one decision`,
          path: ["clearances"],
        });
      }
      seen.add(entry.adapterId);
    }
  });
export type ClearanceRegister = z.infer<typeof ClearanceRegisterSchema>;

export function parseClearanceRegister(raw: unknown): ClearanceRegister {
  return ClearanceRegisterSchema.parse(raw);
}

export function statusFor(register: ClearanceRegister, adapterId: string): LegalStatus {
  return register.clearances.find((c) => c.adapterId === adapterId)?.status ?? "needs-review";
}

/**
 * Returns the adapter with the register's status applied. An adapter absent from the register
 * keeps 'needs-review' — silence is never clearance.
 */
export function applyClearance(adapter: SourceAdapter, register: ClearanceRegister): SourceAdapter {
  return { ...adapter, legalStatus: statusFor(register, adapter.id) };
}

export function applyClearances(
  adapters: readonly SourceAdapter[],
  register: ClearanceRegister,
): SourceAdapter[] {
  return adapters.map((a) => applyClearance(a, register));
}
