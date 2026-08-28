// How an access fact is put on screen.
//
// Two rules, both load-bearing:
//
//   AN UNCONFIRMED FIELD READS AS UNCONFIRMED. Never as "no", never as a blank space. A blank
//   would be read as a negative by anybody scanning the column, and a negative we cannot
//   support is the one error this product cannot afford.
//
//   STALENESS IS WORDS, NOT COLOUR. "confirmed 12 days ago" carries the fact for a reader who
//   cannot see the colour and for one who can. The tint is decoration on top of the sentence.

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

interface FactProps {
  readonly recordKey: AccessFieldKey;
  readonly record: AccessRecord;
  readonly now: Date;
}

function renderValue(key: AccessFieldKey, field: AccessField<unknown>): string {
  const value = field.value;
  if (value === "unknown") return "not confirmed";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return describeDuration(value);
  if (Array.isArray(value)) return value.length === 0 ? "none listed" : value.join(", ");
  return String(value);
}

export function Fact({ recordKey, record, now }: FactProps) {
  const field = record[recordKey] as AccessField<unknown>;
  const state = freshness(recordKey, field, now);
  const unknown = state === "unknown";
  return (
    <div className="fact">
      <span className="fact-key">{ACCESS_FIELD_COPY[recordKey]}</span>
      <span className={unknown ? "fact-unknown" : "fact-val"}>
        {renderValue(recordKey, field)}
        {!unknown && (
          <span className="fact-age">
            {" · confirmed "}
            {describeAge(ageInDays(field.confirmedAt, now))}
          </span>
        )}
      </span>
    </div>
  );
}
