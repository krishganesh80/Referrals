// The things a person can say matter to them. Every one of these is a filter the ADHD.ME finder
// actually applies (src/finder/filters.ts in that tree: telehealth, bulkBilling, longerAppointments,
// wheelchair, openBooks, languages). Nothing here is a symptom, a diagnosis or a care need: the
// ride asks about practical access, which is what the product's own filters are made of.
//
// DOM-free. Shared by the ride, the direct chooser, the matcher and the tests.

export type PreferenceKey =
  | "telehealth"
  | "bulkBilling"
  | "longerAppointments"
  | "wheelchair"
  | "openBooks"
  | "language";

export interface Preference {
  readonly key: PreferenceKey;
  /** Short word for a signpost and a chip. */
  readonly label: string;
  /** The question the signpost asks. Plain, first person, no clinical content. */
  readonly question: string;
  /** How the chip reads once chosen. */
  readonly chosen: string;
  /** One line on why the finder cares, in the product's own terms. */
  readonly why: string;
}

/** Languages beside English that the demo roster declares. The real finder reads them from each clinician's own entry. */
export const LANGUAGES = ["Arabic", "Greek", "Hindi", "Mandarin", "Vietnamese"] as const;
export type Language = (typeof LANGUAGES)[number];

export const PREFERENCES: ReadonlyArray<Preference> = [
  {
    key: "telehealth",
    label: "Telehealth",
    question: "Would an appointment by video or phone suit you?",
    chosen: "Telehealth suits me",
    why: "Only clinicians who offer a first appointment by telehealth are kept.",
  },
  {
    key: "bulkBilling",
    label: "Bulk billing",
    question: "Do you need the appointment bulk billed?",
    chosen: "Bulk billed",
    why: "Only clinicians who declare bulk billing are kept.",
  },
  {
    key: "longerAppointments",
    label: "Longer appointments",
    question: "Would a longer appointment help?",
    chosen: "Longer appointments",
    why: "Only clinicians who offer longer appointments are kept.",
  },
  {
    key: "wheelchair",
    label: "Wheelchair access",
    question: "Do the rooms need wheelchair access?",
    chosen: "Wheelchair access",
    why: "Only rooms declared wheelchair accessible are kept.",
  },
  {
    key: "openBooks",
    label: "New patients",
    question: "Should we only show clinicians taking new patients?",
    chosen: "Taking new patients",
    why: "Only clinicians whose books are declared open are kept.",
  },
  {
    key: "language",
    label: "Language",
    question: "Would you like to speak a language other than English?",
    chosen: "Speaks my language",
    why: "Only clinicians who declare that language are kept.",
  },
];

export function preference(key: PreferenceKey): Preference {
  const found = PREFERENCES.find((p) => p.key === key);
  if (!found) throw new Error(`unknown preference ${key}`);
  return found;
}

/**
 * What the person has chosen. Booleans for the yes/no signposts; the language signpost holds a
 * language or null. Nothing is chosen until the person says so — brushing past a signpost in the
 * ride records nothing.
 */
export interface Selection {
  readonly telehealth: boolean;
  readonly bulkBilling: boolean;
  readonly longerAppointments: boolean;
  readonly wheelchair: boolean;
  readonly openBooks: boolean;
  readonly language: Language | null;
}

export function emptySelection(): Selection {
  return {
    telehealth: false,
    bulkBilling: false,
    longerAppointments: false,
    wheelchair: false,
    openBooks: false,
    language: null,
  };
}

export function isChosen(selection: Selection, key: PreferenceKey): boolean {
  return key === "language" ? selection.language !== null : selection[key];
}

/** The keys chosen, in signpost order. */
export function chosenKeys(selection: Selection): PreferenceKey[] {
  return PREFERENCES.map((p) => p.key).filter((k) => isChosen(selection, k));
}

/** The chip text for a chosen key. */
export function chipText(selection: Selection, key: PreferenceKey): string {
  if (key === "language") return selection.language ? `Speaks ${selection.language}` : preference(key).chosen;
  return preference(key).chosen;
}

export function withChoice(selection: Selection, key: PreferenceKey, value: boolean | Language | null): Selection {
  if (key === "language") {
    const language = typeof value === "string" ? value : null;
    return { ...selection, language };
  }
  return { ...selection, [key]: value === true };
}

export function withoutChoice(selection: Selection, key: PreferenceKey): Selection {
  return withChoice(selection, key, key === "language" ? null : false);
}
