// DEMO MATCHING. Deterministic, explainable, and not the product's matcher.
//
// The rule is borrowed from the ADHD.ME finder's `searchRoster`: every chosen preference must hold,
// and the chosen ones combine as AND. What is added for the demo is the "close" group — clinicians
// who meet all but one chosen preference, named — because a ride that ends in an empty clearing
// teaches nothing. With a single preference chosen there is no such thing as close: a clinician
// either offers it or does not, so the group stays empty. What is deliberately absent is any order within a group beyond the alphabet:
// position must never read as a judgement, and alphabetical order is visibly arbitrary.
//
// DOM-free.

import { chosenKeys, preference, type PreferenceKey, type Selection } from "./preferences";
import { DEMO_ROSTER, type DemoClinician } from "./roster";

export function holds(clinician: DemoClinician, key: PreferenceKey, selection: Selection): boolean {
  switch (key) {
    case "telehealth":
      return clinician.telehealthFirstAppointment;
    case "bulkBilling":
      return clinician.bulkBilling;
    case "longerAppointments":
      return clinician.longerAppointments;
    case "wheelchair":
      return clinician.wheelchairAccessible;
    case "openBooks":
      return clinician.acceptingNewPatients;
    case "language":
      return selection.language !== null && clinician.languages.includes(selection.language);
  }
}

export interface Match {
  readonly clinician: DemoClinician;
  /** The chosen preferences this clinician meets, in signpost order. */
  readonly meets: ReadonlyArray<PreferenceKey>;
  /** The chosen preferences this clinician does not meet. Empty for a full fit. */
  readonly misses: ReadonlyArray<PreferenceKey>;
}

export interface MatchResult {
  /** Meets every chosen preference. Alphabetical. */
  readonly fits: ReadonlyArray<Match>;
  /** Meets all but exactly one. Alphabetical. */
  readonly close: ReadonlyArray<Match>;
  /** Misses two or more; counted, not listed. */
  readonly hidden: number;
  readonly chosen: ReadonlyArray<PreferenceKey>;
}

const byName = (a: Match, b: Match) => a.clinician.name.localeCompare(b.clinician.name, "en-AU");

export function match(selection: Selection, roster: ReadonlyArray<DemoClinician> = DEMO_ROSTER): MatchResult {
  const chosen = chosenKeys(selection);
  const all: Match[] = roster.map((clinician) => {
    const meets = chosen.filter((k) => holds(clinician, k, selection));
    const misses = chosen.filter((k) => !holds(clinician, k, selection));
    return { clinician, meets, misses };
  });
  const fits = all.filter((m) => m.misses.length === 0).sort(byName);
  const close = chosen.length < 2 ? [] : all.filter((m) => m.misses.length === 1).sort(byName);
  const hidden = all.length - fits.length - close.length;
  return { fits, close, hidden, chosen };
}

/** The sentence under a card: which chosen things hold, by their labels. */
export function reasonLines(m: Match, selection: Selection): string[] {
  return m.meets.map((k) =>
    k === "language" && selection.language ? `Speaks ${selection.language}` : preference(k).chosen,
  );
}

export function missingLine(m: Match, selection: Selection): string | null {
  const k = m.misses[0];
  if (k === undefined) return null;
  if (k === "language" && selection.language) return `Does not declare ${selection.language}`;
  const label = preference(k).label.toLowerCase();
  return `Does not offer ${label}`;
}
