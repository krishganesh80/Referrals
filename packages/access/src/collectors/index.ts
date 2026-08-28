// Automated access collectors. Retire manual work wherever a machine can do it.
//
// Same clearance gate as the identity adapters: these ship needs-review and a person flips them
// per source. Parsing is unimplemented — phase one ships the interface and its tests.
//
// The three differ in what they can honestly attach a fact to, and that difference is the design:
// a booking platform speaks for one surgeon, a fund directory speaks for one surgeon, and a state
// health department speaks for a HOSPITAL CLINIC. The third is why `departmentWait` hangs off a
// public PracticeLocation rather than off the surgeon.

import type { AccessSource, AccessTier } from "@referral/core";
import type { LegalStatus } from "@referral/ingest";

export interface AccessCollector {
  readonly id: string;
  readonly legalStatus: LegalStatus;
  readonly tier: AccessTier;
  readonly source: AccessSource;
  readonly description: string;
  /** What this collector is entitled to say something about. */
  readonly attachesTo: "surgeon" | "public-location";
  collect(): Promise<never>;
}

export class CollectorNotImplementedError extends Error {
  constructor(id: string) {
    super(`collector '${id}' has no implementation yet — phase one ships the interface and its tests`);
    this.name = "CollectorNotImplementedError";
  }
}

function stub(config: Omit<AccessCollector, "collect" | "legalStatus">): AccessCollector {
  return {
    ...config,
    legalStatus: "needs-review",
    collect: () => Promise.reject(new CollectorNotImplementedError(config.id)),
  };
}

/** Tier B. Next-available slots give waitToConsultDays and booksOpen for free. */
export function bookingPlatformCollector(): AccessCollector {
  return stub({
    id: "booking-platform",
    tier: "B",
    source: "booking-platform",
    attachesTo: "surgeon",
    description:
      "Next-available appointment slots from online booking platforms. Documented APIs only; never scraped from behind a login.",
  });
}

/** Tier A. Self-maintaining, authoritative, and covers no-gap almost completely. */
export function insurerDirectoryCollector(): AccessCollector {
  return stub({
    id: "insurer-directory",
    tier: "A",
    source: "insurer-directory",
    attachesTo: "surgeon",
    description:
      "No-gap scheme participation from the funds' own public searchable directories. The cheapest high-tier access signal we have.",
  });
}

/** Tier A, but about a hospital department — never about an individual's private wait. */
export function stateHealthWaitCollector(): AccessCollector {
  return stub({
    id: "state-health-wait",
    tier: "A",
    source: "state-health",
    attachesTo: "public-location",
    description:
      "Published specialist clinic and elective surgery waiting times. Attaches to a public PracticeLocation, never to a surgeon: a department figure cannot imply an individual's private wait.",
  });
}

export function allCollectors(): AccessCollector[] {
  return [bookingPlatformCollector(), insurerDirectoryCollector(), stateHealthWaitCollector()];
}
