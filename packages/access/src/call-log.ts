// What happened when we rang. Recorded so the queue does not loop on a room nobody answers.
//
// A call that ends in a refusal or three no-answers is information: it says this record will not
// be verified by phone, and the queue should spend the next call elsewhere. Without this the
// highest-weight unreachable practice sits at the top of the list forever and the caller works
// through the same dead number every week.

import { z } from "zod";
import { IsoDateSchema } from "@referral/core";

export const CALL_OUTCOMES = ["reached", "refused", "no-answer", "wrong-number", "callback"] as const;
export const CallOutcomeSchema = z.enum(CALL_OUTCOMES);
export type CallOutcome = z.infer<typeof CallOutcomeSchema>;

export const CallRecordSchema = z
  .object({
    ahpraId: z.string(),
    outcome: CallOutcomeSchema,
    at: IsoDateSchema,
    /** Free text from the caller. Never a clinical note — this is about reaching a practice. */
    note: z.union([z.string(), z.null()]),
    /** Set when the practice asked to be called back on a date. */
    callbackOn: z.union([IsoDateSchema, z.null()]),
  })
  .strict();
export type CallRecord = z.infer<typeof CallRecordSchema>;

/** Three unanswered calls is enough to stop trying for a while. */
export const NO_ANSWER_LIMIT = 3;
export const NO_ANSWER_COOLDOWN_DAYS = 30;
export const REFUSED_COOLDOWN_DAYS = 180;

export interface CallHistory {
  readonly ahpraId: string;
  readonly records: readonly CallRecord[];
}

function daysBetween(from: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

export interface Suppression {
  readonly suppressed: boolean;
  readonly reason: string | null;
  readonly until: string | null;
}

/**
 * Whether this record should be held out of the queue for now, and why. A cooldown is never
 * permanent: a practice that refused in March is asked again in September, because books and
 * policies change and a single refusal is not a standing instruction.
 */
export function suppressionFor(history: readonly CallRecord[], now: Date): Suppression {
  const sorted = [...history].sort((a, b) => a.at.localeCompare(b.at));
  const last = sorted[sorted.length - 1];
  if (!last) return { suppressed: false, reason: null, until: null };

  const addDays = (from: string, days: number) =>
    new Date(Date.parse(`${from}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

  if (last.outcome === "callback" && last.callbackOn !== null) {
    if (daysBetween(last.callbackOn, now) < 0) {
      return { suppressed: true, reason: "practice asked to be called back later", until: last.callbackOn };
    }
    return { suppressed: false, reason: null, until: null };
  }

  if (last.outcome === "refused" && daysBetween(last.at, now) < REFUSED_COOLDOWN_DAYS) {
    return {
      suppressed: true,
      reason: "practice declined to answer; asked again after the cooldown",
      until: addDays(last.at, REFUSED_COOLDOWN_DAYS),
    };
  }

  if (last.outcome === "wrong-number") {
    return { suppressed: true, reason: "number on file is wrong; needs a new number before calling", until: null };
  }

  // Consecutive no-answers, counted back from the most recent call.
  let consecutive = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i]!.outcome === "no-answer"; i--) consecutive += 1;
  if (consecutive >= NO_ANSWER_LIMIT && daysBetween(last.at, now) < NO_ANSWER_COOLDOWN_DAYS) {
    return {
      suppressed: true,
      reason: `${consecutive} unanswered calls; resting this record`,
      until: addDays(last.at, NO_ANSWER_COOLDOWN_DAYS),
    };
  }

  return { suppressed: false, reason: null, until: null };
}

export function historyIndex(records: readonly CallRecord[]): Map<string, CallRecord[]> {
  const byId = new Map<string, CallRecord[]>();
  for (const record of records) {
    const list = byId.get(record.ahpraId) ?? [];
    list.push(record);
    byId.set(record.ahpraId, list);
  }
  return byId;
}
