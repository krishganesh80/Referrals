// The isolation rule, made mechanical.
//
// The portal holds specialist PII under specialist consent: practice email, sign-in tokens,
// contact details. The GP-facing bundle holds none of that. Data crosses from one to the other
// through this step and only this step, as an export a person reviews — never a live join, and
// never a shared database.
//
// THE EXPORT TYPE IS THE ENFORCEMENT. An export row is an AHPRA id and an access record. There is
// no field on it for an email, a phone number, a sign-in token or a name, so PII cannot cross by
// accident — it would not typecheck, and the schema is `.strict()` so it would not parse either.

import { AccessRecordSchema, type AccessRecord } from "@referral/core";
import { z } from "zod";

export const ExportRowSchema = z
  .object({ ahpraId: z.string(), access: AccessRecordSchema })
  .strict();
export type ExportRow = z.infer<typeof ExportRowSchema>;

export const ReviewedExportSchema = z
  .object({
    generatedAt: z.string(),
    reviewedBy: z.string().min(1),
    reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rows: z.array(ExportRowSchema),
  })
  .strict();
export type ReviewedExport = z.infer<typeof ReviewedExportSchema>;

/** What the portal holds internally. Only the access half ever leaves. */
export interface PortalRecord {
  readonly ahpraId: string;
  readonly practiceEmail: string;
  readonly contactName: string;
  readonly access: AccessRecord;
}

/**
 * Build the export. It takes the reviewer's name because an unreviewed export is not permitted to
 * exist: the signature is the review step, not a flag somebody can pass `false` to.
 */
export function buildReviewedExport(
  records: readonly PortalRecord[],
  reviewer: { name: string; at: string },
  generatedAt: string,
): ReviewedExport {
  return ReviewedExportSchema.parse({
    generatedAt,
    reviewedBy: reviewer.name,
    reviewedAt: reviewer.at,
    rows: records
      .map((record) => ({ ahpraId: record.ahpraId, access: record.access }))
      .sort((a, b) => a.ahpraId.localeCompare(b.ahpraId)),
  });
}
