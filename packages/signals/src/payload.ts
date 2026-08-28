// The one permitted outbound call from the GP client.
//
// It exists to calibrate self-reported access data — rooms say their books are open, the outcome
// signal says four in five referrals to them were declined — and it is designed so that no amount
// of server compromise or legal compulsion can yield clinical information, because none is ever
// transmitted.
//
// FOUR FIELDS. NOTHING ELSE. No criteria, no sub-specialty, no postcode, no patient attribute, no
// practice identifier, and no timestamp finer than the ISO week. The schema is `.strict()`, so an
// extra field is a parse failure on both ends rather than something quietly ignored by one of
// them — and a property test asserts that no field outside this list can be serialised.

import { z } from "zod";

export const OUTCOMES = ["accepted", "declined", "no-response"] as const;
export const OutcomeSchema = z.enum(OUTCOMES);
export type Outcome = z.infer<typeof OutcomeSchema>;

/** ISO week, e.g. 2026-W35. Deliberately the finest time granularity in the whole payload. */
export const WeekBucketSchema = z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, "expected e.g. 2026-W35");

/**
 * Random, rotated every 90 days, never linked to an identity. It exists only so the k-anonymity
 * threshold can count distinct installs rather than distinct pings — one enthusiastic practice
 * must not be able to make a cell readable on its own.
 */
export const InstallTokenSchema = z.string().regex(/^[0-9a-f]{32}$/, "expected 32 hex characters");

export const PingSchema = z
  .object({
    surgeonId: z.string().regex(/^[A-Z]{3}\d{10}$/),
    outcome: OutcomeSchema,
    weekBucket: WeekBucketSchema,
    installToken: InstallTokenSchema,
  })
  .strict();
export type Ping = z.infer<typeof PingSchema>;

/** The permitted field names, exported so the property test cannot drift from the schema. */
export const PERMITTED_PING_FIELDS = ["surgeonId", "outcome", "weekBucket", "installToken"] as const;

export const TOKEN_ROTATION_DAYS = 90;

export function isoWeekOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO-8601: week 1 is the week containing the first Thursday.
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
