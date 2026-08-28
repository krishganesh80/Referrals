// Deterministic synthetic fixtures.
//
// EVERY SURGEON IN HERE IS INVENTED. The names are obviously fictional on purpose: this
// directory describes real, identifiable practitioners in production, and fixture data that
// looked plausible would eventually be mistaken for the real thing by somebody reading a test
// failure at speed.
//
// Seeded throughout — no `Math.random` — so the golden files and the dev server show the same
// records on every machine and every run.

import type {
  AccessField,
  AccessRecord,
  AccessSource,
  AccessTier,
  EvidenceTier,
  PracticeLocation,
  Subspecialty,
  Surgeon,
} from "./schema";
import { SUBSPECIALTIES } from "./schema";

/** mulberry32 — small, fast, and identical everywhere. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAMILY = [
  "Aldergrove", "Bramwell", "Cadwallader", "Dunmore", "Ellingham", "Fairweather",
  "Gainsborough", "Harkaway", "Ingleby", "Jarrowfield", "Kestrelton", "Lampeter",
  "Marchbanks", "Netherfield", "Oakhampton", "Pemberley", "Quillfeather", "Ravensmoor",
  "Stanhope", "Thackeray", "Underhill", "Vasterling", "Wintersgill", "Yarrowmede",
  "Zephyrhill",
];
const GIVEN = [
  "Alice", "Bernard", "Clara", "Desmond", "Elena", "Farrukh", "Greta", "Hamish",
  "Ingrid", "Jonas", "Keiko", "Lachlan", "Mira", "Nikolai", "Orla", "Priya",
  "Quentin", "Rosalind", "Sunil", "Tamsin", "Ulrich", "Verity", "Wilhelmina", "Xavier",
  "Yusuf",
];

const SOCIETY_EVIDENCE: Readonly<Record<Subspecialty, string>> = {
  hip_knee_arthroplasty: "Arthroplasty Society of Australia member",
  knee_sports: "Australian Knee Society member",
  shoulder_elbow: "Shoulder & Elbow Society of Australia member",
  hand_wrist: "Australian Hand Surgery Society member",
  foot_ankle: "Australian Foot & Ankle Society member",
  spine: "Spine Society of Australia member",
  paediatric: "Paediatric Orthopaedic Society of Australia member",
  trauma_limb_recon: "Limb reconstruction fellowship, hospital credentialing record",
  tumour: "Australian Sarcoma Group affiliation",
};

const TIER_B_EVIDENCE: Readonly<Record<Subspecialty, string>> = {
  hip_knee_arthroplasty: "12 arthroplasty publications indexed since registration",
  knee_sports: "9 ligament reconstruction publications indexed since registration",
  shoulder_elbow: "7 shoulder publications indexed since registration",
  hand_wrist: "Credentialed for hand surgery at two listed hospitals",
  foot_ankle: "Credentialed for foot & ankle surgery at a listed hospital",
  spine: "11 spine publications indexed since registration",
  paediatric: "Credentialed at a listed paediatric hospital",
  trauma_limb_recon: "Credentialed for trauma at a listed public hospital",
  tumour: "6 sarcoma publications indexed since registration",
};

/** Melbourne, roughly. Rooms cluster inner-east; operating sites spread wider. */
const MELBOURNE = { lat: -37.8136, lng: 144.9631 };

const HOSPITALS = [
  { name: "Eastbourne Private Hospital", sector: "private" as const, suburb: "Box Hill", postcode: "3128" },
  { name: "Northmoor Private Hospital", sector: "private" as const, suburb: "Bundoora", postcode: "3083" },
  { name: "Riverbend Private Hospital", sector: "private" as const, suburb: "Richmond", postcode: "3121" },
  { name: "Cardinia Public Hospital", sector: "public" as const, suburb: "Berwick", postcode: "3806" },
  { name: "Werribee Plains Public Hospital", sector: "public" as const, suburb: "Werribee", postcode: "3030" },
  { name: "Fitzroy North Public Hospital", sector: "public" as const, suburb: "Fitzroy North", postcode: "3068" },
];

function isoDaysAgo(days: number, now: Date): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

interface FieldSpec {
  readonly tier: AccessTier;
  readonly source: AccessSource;
  readonly maxAgeDays: number;
}

const PAYER_SPEC: FieldSpec = { tier: "S", source: "portal", maxAgeDays: 420 };
const PHONE_SPEC: FieldSpec = { tier: "A", source: "phone", maxAgeDays: 300 };
const BOOKING_SPEC: FieldSpec = { tier: "B", source: "booking-platform", maxAgeDays: 70 };
const FUND_SPEC: FieldSpec = { tier: "A", source: "insurer-directory", maxAgeDays: 200 };

function field<T>(
  value: T | "unknown",
  spec: FieldSpec,
  rand: () => number,
  now: Date,
): AccessField<T> {
  return {
    value,
    tier: spec.tier,
    source: spec.source,
    confirmedAt: isoDaysAgo(Math.floor(rand() * spec.maxAgeDays), now),
  };
}

const FUNDS = ["HCF", "Bupa", "Medibank", "NIB", "AHM", "HBF"];

export interface FixtureOptions {
  readonly count?: number;
  /** Fraction of access fields forced to `'unknown'`. 0.8 is what launch actually looks like. */
  readonly unknownRatio?: number;
  readonly seed?: number;
  readonly now?: Date;
}

export function makeFixtureSurgeons(options: FixtureOptions = {}): Surgeon[] {
  const count = options.count ?? 50;
  const unknownRatio = options.unknownRatio ?? 0.25;
  const now = options.now ?? new Date("2026-08-28T00:00:00.000Z");
  const rand = seeded(options.seed ?? 20260828);

  const maybe = <T>(value: T | "unknown", spec: FieldSpec): AccessField<T> =>
    field<T>(rand() < unknownRatio ? "unknown" : value, spec, rand, now);

  const surgeons: Surgeon[] = [];
  for (let i = 0; i < count; i++) {
    const familyName = `${FAMILY[i % FAMILY.length]}${i >= FAMILY.length ? "-Ashby" : ""}`;
    const givenNames = GIVEN[(i * 7) % GIVEN.length] ?? "Alex";
    const ahpraId = `MED${String(1000000000 + i * 137).slice(0, 10)}`;

    // One or two buckets, drawn deterministically. A quarter of records carry no tag at all —
    // the launch reality the matcher must not bury.
    const tagCount = rand() < 0.25 ? 0 : rand() < 0.65 ? 1 : 2;
    const tags = [] as Surgeon["subspecialtyTags"];
    const used = new Set<Subspecialty>();
    for (let t = 0; t < tagCount; t++) {
      const bucket = SUBSPECIALTIES[Math.floor(rand() * SUBSPECIALTIES.length)] as Subspecialty;
      if (used.has(bucket)) continue;
      used.add(bucket);
      const roll = rand();
      const tier: EvidenceTier = roll < 0.45 ? "A" : roll < 0.8 ? "B" : "C";
      tags.push({
        bucket,
        tier,
        evidence:
          tier === "A"
            ? (SOCIETY_EVIDENCE[bucket] ?? "Sub-specialty society member")
            : tier === "B"
              ? (TIER_B_EVIDENCE[bucket] ?? "Hospital credentialing record")
              : "Listed on practice website",
        sourceRecordIds: [`src-${ahpraId}-${t}`],
      });
    }

    const locations: PracticeLocation[] = [];
    const roomsJitter = () => (rand() - 0.5) * 0.35;
    locations.push({
      id: `${ahpraId}-rooms`,
      kind: "rooms",
      name: `${familyName} Orthopaedic Rooms`,
      address: `${1 + Math.floor(rand() * 400)} Wattletree Road`,
      suburb: "Malvern",
      state: "VIC",
      postcode: "3144",
      lat: MELBOURNE.lat + roomsJitter(),
      lng: MELBOURNE.lng + roomsJitter(),
      sector: "private",
      departmentWait: null,
    });
    const hospital = HOSPITALS[Math.floor(rand() * HOSPITALS.length)] ?? HOSPITALS[0]!;
    const publicWaitDays = 60 + Math.floor(rand() * 260);
    locations.push({
      id: `${ahpraId}-op`,
      kind: "operating",
      name: hospital.name,
      address: `${1 + Math.floor(rand() * 200)} Hospital Drive`,
      suburb: hospital.suburb,
      state: "VIC",
      postcode: hospital.postcode,
      lat: MELBOURNE.lat + (rand() - 0.5) * 0.8,
      lng: MELBOURNE.lng + (rand() - 0.5) * 0.8,
      sector: hospital.sector,
      departmentWait:
        hospital.sector === "public"
          ? {
              waitToConsultDays: field<number>(publicWaitDays, { tier: "A", source: "state-health", maxAgeDays: 120 }, rand, now),
              waitToSurgeryDays: field<number>(publicWaitDays + 90, { tier: "A", source: "state-health", maxAgeDays: 120 }, rand, now),
            }
          : null,
    });

    const fundCount = Math.floor(rand() * 4);
    const funds = FUNDS.slice(0, fundCount);

    const access: AccessRecord = {
      workcover: maybe<boolean>(rand() < 0.6, PAYER_SPEC),
      tac: maybe<boolean>(rand() < 0.5, PAYER_SPEC),
      ctp: maybe<boolean>(rand() < 0.35, PHONE_SPEC),
      dva: maybe<boolean>(rand() < 0.55, PHONE_SPEC),
      comcare: maybe<boolean>(rand() < 0.3, PHONE_SPEC),
      noGapFunds: maybe<string[]>(funds, FUND_SPEC),
      bulkBillsInitial: maybe<boolean>(rand() < 0.15, PAYER_SPEC),
      booksOpen: maybe<boolean>(rand() < 0.75, BOOKING_SPEC),
      waitToConsultDays: maybe<number>(7 + Math.floor(rand() * 120), BOOKING_SPEC),
      waitToSurgeryDays: maybe<number>(30 + Math.floor(rand() * 200), PAYER_SPEC),
    };

    surgeons.push({
      ahpraId,
      familyName,
      givenNames,
      preferredName: null,
      specialistRegistration: {
        specialty: "Orthopaedic surgery",
        since: isoDaysAgo(1200 + Math.floor(rand() * 8000), now),
      },
      disciplineOfOrigin: "orthopaedic",
      subspecialtyTags: tags,
      locations,
      languages: rand() < 0.3 ? ["English", "Greek"] : ["English"],
      telehealth: rand() < 0.5,
      access,
      referralWeight: Math.round(rand() * 1000) / 1000,
      sourceRecords: [],
      lastReviewedAt: rand() < 0.4 ? isoDaysAgo(Math.floor(rand() * 300), now) : null,
    });
  }
  return surgeons;
}

/** The launch-shaped set: 80% of access fields unconfirmed. Tested as the normal case. */
export function makeUnknownHeavyFixtures(options: FixtureOptions = {}): Surgeon[] {
  return makeFixtureSurgeons({ unknownRatio: 0.8, seed: 8080, ...options });
}

/** Postcode centroids for the fixture set. The real gazetteer ships in the bundle. */
export const FIXTURE_POSTCODE_CENTROIDS: Readonly<Record<string, { lat: number; lng: number }>> = {
  "3000": { lat: -37.8136, lng: 144.9631 },
  "3144": { lat: -37.8599, lng: 145.0273 },
  "3121": { lat: -37.8226, lng: 144.9975 },
  "3128": { lat: -37.8195, lng: 145.1234 },
  "3083": { lat: -37.7016, lng: 145.0574 },
  "3806": { lat: -38.0353, lng: 145.3444 },
  "3030": { lat: -37.9, lng: 144.6614 },
  "3068": { lat: -37.7833, lng: 144.9833 },
};
