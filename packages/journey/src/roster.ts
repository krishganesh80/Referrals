// TEN INVENTED CLINICIANS. Every name, suburb and practice here is fictional and must read as
// fictional: the real product describes real, identifiable practitioners who have confirmed their
// own entries, and plausible-looking fake data would eventually be mistaken for the real thing.
// The field shapes follow the ADHD.ME finder's clinician record so the demo matcher asks the same
// questions the product does.
//
// DOM-free.

import type { Language } from "./preferences";

export type Profession = "GP" | "Psychiatrist" | "Paediatrician";

export interface DemoClinician {
  readonly id: string;
  readonly name: string;
  readonly profession: Profession;
  /** Invented place names, on purpose. */
  readonly suburb: string;
  readonly telehealthFirstAppointment: boolean;
  readonly bulkBilling: boolean;
  readonly longerAppointments: boolean;
  readonly wheelchairAccessible: boolean;
  readonly acceptingNewPatients: boolean;
  /** Languages beside English the clinician declares. */
  readonly languages: ReadonlyArray<Language>;
}

export const DEMO_ROSTER: ReadonlyArray<DemoClinician> = [
  { id: "banksia", name: "Dr Wren Banksia", profession: "GP", suburb: "Kingfisher Point", telehealthFirstAppointment: true, bulkBilling: true, longerAppointments: true, wheelchairAccessible: true, acceptingNewPatients: true, languages: ["Mandarin"] },
  { id: "grevillea", name: "Dr Theo Grevillea", profession: "GP", suburb: "Acacia Flats", telehealthFirstAppointment: false, bulkBilling: true, longerAppointments: true, wheelchairAccessible: false, acceptingNewPatients: true, languages: [] },
  { id: "boronia", name: "Dr Mina Boronia", profession: "Psychiatrist", suburb: "Lorikeet Rise", telehealthFirstAppointment: true, bulkBilling: false, longerAppointments: true, wheelchairAccessible: true, acceptingNewPatients: false, languages: ["Greek"] },
  { id: "callistemon", name: "Dr Sol Callistemon", profession: "GP", suburb: "Wattle Hollow", telehealthFirstAppointment: true, bulkBilling: true, longerAppointments: false, wheelchairAccessible: true, acceptingNewPatients: true, languages: ["Arabic", "Hindi"] },
  { id: "hakea", name: "Dr Ivy Hakea", profession: "Paediatrician", suburb: "Kingfisher Point", telehealthFirstAppointment: false, bulkBilling: false, longerAppointments: true, wheelchairAccessible: true, acceptingNewPatients: true, languages: ["Vietnamese"] },
  { id: "melaleuca", name: "Dr Kip Melaleuca", profession: "GP", suburb: "Summit Camp", telehealthFirstAppointment: true, bulkBilling: false, longerAppointments: false, wheelchairAccessible: false, acceptingNewPatients: true, languages: [] },
  { id: "eucalypt", name: "Dr Ren Eucalypt", profession: "GP", suburb: "Acacia Flats", telehealthFirstAppointment: true, bulkBilling: true, longerAppointments: true, wheelchairAccessible: false, acceptingNewPatients: false, languages: ["Hindi"] },
  { id: "correa", name: "Dr Lou Correa", profession: "Psychiatrist", suburb: "Lorikeet Rise", telehealthFirstAppointment: true, bulkBilling: false, longerAppointments: true, wheelchairAccessible: true, acceptingNewPatients: true, languages: ["Mandarin", "Vietnamese"] },
  { id: "kunzea", name: "Dr Pip Kunzea", profession: "GP", suburb: "Wattle Hollow", telehealthFirstAppointment: false, bulkBilling: true, longerAppointments: false, wheelchairAccessible: true, acceptingNewPatients: true, languages: ["Greek", "Arabic"] },
  { id: "lomandra", name: "Dr Ash Lomandra", profession: "GP", suburb: "Summit Camp", telehealthFirstAppointment: true, bulkBilling: true, longerAppointments: true, wheelchairAccessible: true, acceptingNewPatients: true, languages: [] },
];
