// The six identity sources.
//
// EVERY ONE SHIPS AS 'needs-review'. That is not a placeholder to be tidied up later — it is the
// gate. Each source's terms of use have to be read by a person, and that person flips its status
// individually. The runner refuses the whole batch until they do.
//
// Parsing is deliberately unimplemented. The skeleton, the gate and the tests come first; not a
// single page has been fetched. `fetch()` is wired through the shared FetchPolicy so that when a
// source is cleared, the robots check, the User-Agent, the rate limit and the 24-hour snapshot
// window are already in force and cannot be forgotten.

import type { FetchPolicy } from "../fetch-policy";
import type { Subspecialty } from "@referral/core";
import type { PartialSurgeon, RawSnapshot, SourceAdapter } from "../types";

export class NotImplementedError extends Error {
  constructor(adapterId: string) {
    super(`adapter '${adapterId}' has no parser yet — phase one ships the interface and its tests`);
    this.name = "NotImplementedError";
  }
}

interface StubConfig {
  readonly id: string;
  readonly url: string;
  readonly defaultTier: "A" | "B" | "C";
  readonly description: string;
}

function stub(policy: FetchPolicy, config: StubConfig): SourceAdapter {
  return {
    id: config.id,
    legalStatus: "needs-review",
    defaultTier: config.defaultTier,
    description: config.description,
    fetch: (): Promise<RawSnapshot> => policy.snapshot(config.id, config.url),
    parse: (): Promise<PartialSurgeon[]> => Promise.reject(new NotImplementedError(config.id)),
  };
}

/** Tier A. Specialist registration, conditions and undertakings. The canonical key comes from here. */
export function ahpraRegisterAdapter(policy: FetchPolicy): SourceAdapter {
  return stub(policy, {
    id: "ahpra-register",
    url: "https://www.ahpra.gov.au/registration/registers-of-practitioners.aspx",
    defaultTier: "A",
    description: "AHPRA register of practitioners — specialist registration, conditions, undertakings.",
  });
}

export interface SocietyConfig {
  readonly key: string;
  readonly name: string;
  readonly url: string;
  readonly bucket: Subspecialty;
  /**
   * Whether the URL above has actually been confirmed to serve a public listing.
   *
   * `verified`     — fetched, parsed, entry count known.
   * `site-exists`  — the domain resolves and robots permits, but the directory path and whether
   *                  it is public rather than members-only has NOT been confirmed.
   * `members-only` — the listing appears to sit behind a login. Not to be fetched: the brief is
   *                  explicit that we do not scrape behind a login.
   */
  readonly directoryStatus: "verified" | "site-exists" | "members-only";
}

/**
 * Tier A, and the highest-value signal in the product: a society membership is a surgeon telling
 * their peers what they do, which is a far harder statement than a practice website.
 *
 * THESE URLS WERE CHECKED, NOT ASSUMED. An earlier draft of this file carried plausible-looking
 * domains that had simply been guessed; three of them had no DNS record at all. Every entry below
 * has been resolved and its robots.txt read on 2026-08-28, and each carries the status of what was
 * actually found rather than what would be convenient.
 */
export const SUBSPECIALTY_SOCIETIES: readonly SocietyConfig[] = [
  {
    key: "hand",
    name: "Australian Hand Surgery Society",
    url: "https://ahss.org.au/hand-surgery-public-directory/",
    bucket: "hand_wrist",
    directoryStatus: "verified",
  },
  {
    key: "knee",
    name: "Australian Knee Society",
    url: "https://www.kneesociety.org.au/",
    bucket: "knee_sports",
    directoryStatus: "site-exists",
  },
  {
    key: "shoulder-elbow",
    name: "Shoulder & Elbow Society of Australia",
    url: "https://www.sesa.org.au/",
    bucket: "shoulder_elbow",
    directoryStatus: "site-exists",
  },
  {
    key: "foot-ankle",
    name: "Australian Foot & Ankle Society",
    // Publishes Crawl-delay: 10. The fetch policy honours it; do not lower it here.
    url: "https://afas.org.au/",
    bucket: "foot_ankle",
    directoryStatus: "site-exists",
  },
  {
    key: "spine",
    name: "Spine Society of Australia",
    url: "https://spinesociety.org.au/",
    bucket: "spine",
    directoryStatus: "site-exists",
  },
  {
    key: "arthroplasty",
    name: "Arthroplasty Society of Australia",
    url: "https://arthroplasty.org.au/directory-of-asa-members/",
    bucket: "hip_knee_arthroplasty",
    directoryStatus: "members-only",
  },
  {
    key: "paediatric",
    name: "Australian Paediatric Orthopaedic Society",
    url: "https://www.apos.org.au/",
    bucket: "paediatric",
    directoryStatus: "members-only",
  },
];

export function subspecialtySocietyAdapter(policy: FetchPolicy, society: SocietyConfig): SourceAdapter {
  return stub(policy, {
    id: `society-${society.key}`,
    url: society.url,
    defaultTier: "A",
    description: `${society.name} membership listing (${society.directoryStatus}).`,
  });
}

/** Societies whose listing is public. The members-only ones are deliberately not included. */
export function subspecialtySocietyAdapters(policy: FetchPolicy): SourceAdapter[] {
  return SUBSPECIALTY_SOCIETIES.filter((s) => s.directoryStatus !== "members-only").map((s) =>
    subspecialtySocietyAdapter(policy, s),
  );
}

/** Tier B. Public and private hospital specialist listings. Yields operating locations. */
export function hospitalCredentialingAdapter(policy: FetchPolicy, hospitalUrl: string, key: string): SourceAdapter {
  return stub(policy, {
    id: `hospital-${key}`,
    url: hospitalUrl,
    defaultTier: "B",
    description: "Hospital specialist listing — yields operating locations and credentialing signal.",
  });
}

/**
 * Tier B. PubMed E-utilities is a documented public API, so this uses it rather than scraping.
 * MeSH terms map to buckets, normalised by years since specialist registration so a long career
 * does not read as a sub-specialty.
 */
export function publicationAdapter(policy: FetchPolicy): SourceAdapter {
  return stub(policy, {
    id: "pubmed-eutilities",
    url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=",
    defaultTier: "B",
    description: "PubMed E-utilities — documented public API. MeSH terms to buckets, career-length normalised.",
  });
}

/** Tier C. Candidate tags for human review only; tier C never auto-promotes onto a record. */
export function practiceSiteAdapter(policy: FetchPolicy, siteUrl: string, key: string): SourceAdapter {
  return stub(policy, {
    id: `practice-site-${key}`,
    url: siteUrl,
    defaultTier: "C",
    description: "Practice website — generates candidate tags for human review, never facts.",
  });
}

/**
 * The licensed feed that is intended to replace several of the scrapers above. Interface and
 * tests only — no implementation, and no access data ever: the AOA will not carry who a surgeon
 * accepts or how long their wait is, so the access subsystem stands alone permanently.
 */
export function aoaFeedAdapter(policy: FetchPolicy): SourceAdapter {
  return stub(policy, {
    id: "aoa-feed",
    url: "https://feed.aoa.org.au/v1/members",
    defaultTier: "A",
    description: "Australian Orthopaedic Association licensed feed. Identity only — never access data.",
  });
}

export { ahssDirectoryAdapter, parseAhssDirectory, AHSS_DIRECTORY_URL } from "./ahss";
