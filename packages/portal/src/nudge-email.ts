// The monthly nudge. This is the conversion mechanism, so it is a first-class module with its own
// tests rather than a string built somewhere inside a mailer.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// A CONFLICT IN THE BRIEF, RESOLVED THE ONLY WAY IT CAN BE. FLAGGED TO THE FOUNDER.
//
// The brief asks this email to carry a usage line drawn from aggregate search data:
//
//     "GPs filtered for surgeons accepting TAC in your postcode N times last month; your record
//      shows unknown for TAC, so you did not appear."
//
// That line cannot be written, because the data behind it is data the product has decided never
// to collect. Constraint 2 says patient data never leaves the GP's machine and there is no
// matching API; the single permitted outbound call carries an AHPRA id, an outcome, an ISO week
// and a rotating token — no criteria, no postcode. "GPs filtered for TAC in your postcode" is
// precisely a criterion and a postcode. Building it would mean adding a second telemetry stream
// that reports what GPs searched for, which is the thing the privacy design exists to prevent.
//
// So the usage line is built from the two sources we legitimately have:
//
//   THE SUPPRESSED OUTCOME AGGREGATE — how many referrals reached this surgeon, from
//   `@referral/signals`, already past the k-anonymity threshold. This is about them, not about
//   what anyone searched for.
//
//   THE PRODUCT'S OWN BEHAVIOUR — "GPs filtering for TAC cannot see you as accepting it" is a
//   true statement about how the matcher treats an unconfirmed field, and needs no telemetry at
//   all. It carries the same motivation as the original line without inventing the evidence.
//
// If the founder wants the literal line from the brief, it needs an explicit decision to collect
// search criteria, and that is a change to constraint 2 rather than a feature of this module.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { ACCESS_FIELD_COPY } from "@referral/core";
import type { Completeness } from "./completeness";

export interface NudgeInputs {
  readonly displayName: string;
  readonly completeness: Completeness;
  /**
   * Referrals recorded as reaching this surgeon last month, from the suppressed outcome
   * aggregate. Null when the cell is below the k-anonymity threshold — which is most of them,
   * most of the time, and the email must read well without it.
   */
  readonly referralsLastMonth: number | null;
  readonly signInUrl: string;
  readonly monthLabel: string;
}

export interface NudgeEmail {
  readonly subject: string;
  readonly text: string;
}

export function renderNudgeEmail(inputs: NudgeInputs): NudgeEmail {
  const { completeness, referralsLastMonth } = inputs;
  const topGaps = completeness.gaps.slice(0, 3);

  const subject =
    completeness.gaps.length === 0
      ? `Your referral profile is up to date`
      : `${completeness.gaps.length} unconfirmed ${completeness.gaps.length === 1 ? "field" : "fields"} on your referral profile`;

  const lines: string[] = [];
  lines.push(`Dr ${inputs.displayName},`);
  lines.push("");

  if (referralsLastMonth !== null) {
    lines.push(
      `${referralsLastMonth} referrals recorded through the tool reached you in ${inputs.monthLabel}.`,
    );
    lines.push("");
  }

  if (completeness.gaps.length === 0) {
    lines.push("Every field on your profile is confirmed and current. Nothing needs doing.");
  } else {
    lines.push(`Your profile is ${completeness.percent}% confirmed. These are the gaps:`);
    lines.push("");
    for (const gap of topGaps) lines.push(`  ${ACCESS_FIELD_COPY[gap.key]} — ${gap.consequence}`);
    if (completeness.gaps.length > topGaps.length) {
      lines.push(`  and ${completeness.gaps.length - topGaps.length} more.`);
    }
    lines.push("");
    lines.push("Confirming takes about thirty seconds, and confirming that nothing has changed");
    lines.push("counts as much as changing something — a fact dated today outranks the same fact");
    lines.push("going stale.");
  }

  lines.push("");
  lines.push(inputs.signInUrl);
  lines.push("");
  lines.push("This link signs you in without a password and expires in 20 minutes.");
  lines.push("");
  // Named explicitly, because a specialist deciding whether to bother should know the answer.
  lines.push("Completeness improves how often you appear. Nothing on this site can be paid for.");

  return { subject, text: lines.join("\n") };
}
