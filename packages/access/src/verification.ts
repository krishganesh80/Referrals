// The phone call, as data.
//
// This is a person on a call with a receptionist who has other things to do. Every design choice
// here is about the caller's next ten seconds: only stale or unknown fields are asked about, the
// current value is shown so the caller can say "we have you as X, is that still right", and one
// keystroke answers.
//
// SKIPPING AND ANSWERING UNKNOWN ARE DIFFERENT ACTS. Enter skips: the field keeps whatever it had,
// including its old confirmation date. `?` records that we asked and they could not say, which
// resets the field to unknown WITH today's date — so the queue stops asking and the UI stops
// implying we simply never got around to it. Conflating the two would quietly re-confirm facts
// nobody actually confirmed.

import {
  ACCESS_FIELD_COPY,
  ageInDays,
  describeAge,
  describeDuration,
  freshness,
  type AccessField,
  type AccessFieldKey,
  type AccessRecord,
  type Surgeon,
  type Tri,
} from "@referral/core";
import { z } from "zod";

export type FieldKind = "tri" | "days" | "funds";

export function kindOf(key: AccessFieldKey): FieldKind {
  if (key === "noGapFunds") return "funds";
  if (key === "waitToConsultDays" || key === "waitToSurgeryDays") return "days";
  return "tri";
}

export interface Prompt {
  readonly key: AccessFieldKey;
  readonly label: string;
  readonly kind: FieldKind;
  /** What we hold now, said the way the caller should say it. */
  readonly current: string;
  readonly hint: string;
}

const HINTS: Readonly<Record<FieldKind, string>> = {
  tri: "y / n / ? unsure / enter to skip",
  days: "days, or 6w for weeks / ? unsure / enter to skip",
  funds: "comma-separated fund names, none / ? unsure / enter to skip",
};

export function promptFor(key: AccessFieldKey, record: AccessRecord, now: Date): Prompt {
  const field = record[key] as AccessField<unknown>;
  const state = freshness(key, field, now);
  const value = field.value;
  const said =
    value === "unknown"
      ? "not confirmed"
      : typeof value === "boolean"
        ? value ? "yes" : "no"
        : typeof value === "number"
          ? describeDuration(value)
          : Array.isArray(value)
            ? value.length === 0 ? "none listed" : value.join(", ")
            : String(value);
  const age = value === "unknown" ? "" : `, confirmed ${describeAge(ageInDays(field.confirmedAt, now))}`;
  return {
    key,
    label: ACCESS_FIELD_COPY[key],
    kind: kindOf(key),
    current: `${said}${age} [${state}]`,
    hint: HINTS[kindOf(key)],
  };
}

export type Answer =
  | { readonly kind: "skip" }
  | { readonly kind: "unknown" }
  | { readonly kind: "value"; readonly value: Tri | number | string[] };

export function parseAnswer(kind: FieldKind, raw: string): Answer | { kind: "invalid"; message: string } {
  const text = raw.trim();
  if (text === "") return { kind: "skip" };
  if (text === "?") return { kind: "unknown" };

  if (kind === "tri") {
    const lower = text.toLowerCase();
    if (["y", "yes"].includes(lower)) return { kind: "value", value: true };
    if (["n", "no"].includes(lower)) return { kind: "value", value: false };
    return { kind: "invalid", message: "answer y, n, ? or enter to skip" };
  }

  if (kind === "days") {
    const weeks = /^(\d+(?:\.\d+)?)\s*w(?:eeks?)?$/i.exec(text);
    const months = /^(\d+(?:\.\d+)?)\s*m(?:onths?)?$/i.exec(text);
    const days = /^(\d+)\s*(?:d(?:ays?)?)?$/i.exec(text);
    if (weeks) return { kind: "value", value: Math.round(Number(weeks[1]) * 7) };
    if (months) return { kind: "value", value: Math.round(Number(months[1]) * 30.44) };
    if (days) return { kind: "value", value: Number(days[1]) };
    return { kind: "invalid", message: "answer a number of days, or 6w for weeks" };
  }

  if (text.toLowerCase() === "none") return { kind: "value", value: [] };
  return {
    kind: "value",
    value: text.split(",").map((f) => f.trim()).filter((f) => f !== ""),
  };
}

// ---------------------------------------------------------------------------
// The patch that gets written to /data/reviewed
// ---------------------------------------------------------------------------

export const AccessPatchSchema = z
  .object({
    ahpraId: z.string(),
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    by: z.string().min(1),
    /** Only the fields the caller actually answered. A skipped field is absent, not null. */
    fields: z.record(z.string(), z.object({
      value: z.union([z.boolean(), z.number(), z.array(z.string()), z.literal("unknown")]),
    }).strict()),
  })
  .strict();
export type AccessPatch = z.infer<typeof AccessPatchSchema>;

export function buildPatch(
  ahpraId: string,
  answers: ReadonlyMap<AccessFieldKey, Answer>,
  meta: { at: string; by: string },
): AccessPatch {
  const fields: Record<string, { value: boolean | number | string[] | "unknown" }> = {};
  for (const [key, answer] of answers) {
    if (answer.kind === "skip") continue;
    fields[key] = { value: answer.kind === "unknown" ? "unknown" : answer.value };
  }
  return AccessPatchSchema.parse({ ahpraId, at: meta.at, by: meta.by, fields });
}

/**
 * Apply a phone patch. Everything a caller confirms is tier A from source `phone` — including a
 * recorded "they could not say", which is a real confirmation that the answer is unknown today
 * rather than an absence of effort.
 */
export function applyPatch(surgeon: Surgeon, patch: AccessPatch): Surgeon {
  const access: Record<string, unknown> = { ...surgeon.access };
  for (const [key, entry] of Object.entries(patch.fields)) {
    access[key] = { value: entry.value, tier: "A", source: "phone", confirmedAt: patch.at };
  }
  return { ...surgeon, access: access as AccessRecord, lastReviewedAt: patch.at };
}
