// How an access fact is put on screen.
//
// Three rules, all load-bearing:
//
//   AN UNCONFIRMED FIELD READS AS UNCONFIRMED. Never as "no", never as a blank space. A blank is
//   read as a negative by anybody scanning a column, and a negative we cannot support is the one
//   error this product must not make.
//
//   STALENESS IS WORDS FIRST. "confirmed 12 days ago" carries the fact for a reader who cannot
//   see the tint and for one who can. The coloured pip repeats the word; it never replaces it.
//
//   THE FIELD THE GP FILTERED ON IS MARKED. Not re-ordered or re-worded — just marked, so the
//   answer to the question they actually asked is findable without reading the whole block.

import {
  ACCESS_FIELD_COPY,
  ageInDays,
  describeAge,
  describeDuration,
  freshness,
  type AccessField,
  type AccessFieldKey,
  type AccessRecord,
} from "@referral/core";

const FRESHNESS_WORD: Record<string, string> = {
  fresh: "recently confirmed",
  ageing: "ageing",
  stale: "not confirmed lately",
  unknown: "not confirmed",
};

function renderValue(field: AccessField<unknown>): string {
  const value = field.value;
  if (value === "unknown") return "not confirmed";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return describeDuration(value);
  if (Array.isArray(value)) return value.length === 0 ? "none listed" : value.join(", ");
  return String(value);
}

interface FactProps {
  readonly recordKey: AccessFieldKey;
  readonly record: AccessRecord;
  readonly now: Date;
  readonly selected?: boolean;
}

export function Fact({ recordKey, record, now, selected = false }: FactProps) {
  const field = record[recordKey] as AccessField<unknown>;
  const state = freshness(recordKey, field, now);
  const unknown = state === "unknown";
  const age = describeAge(ageInDays(field.confirmedAt, now));

  return (
    <div className={selected ? "fact selected" : "fact"}>
      <span className="fact-key">{ACCESS_FIELD_COPY[recordKey]}</span>
      <span className={unknown ? "fact-unknown" : "fact-val"}>
        <span className={`pip pip-${state}`} aria-hidden="true" />
        {renderValue(field)}
        {!unknown && (
          <span className="fact-age" title={FRESHNESS_WORD[state]}>
            {" · confirmed "}
            {age}
          </span>
        )}
      </span>
    </div>
  );
}
