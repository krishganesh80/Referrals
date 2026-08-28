// Every human-readable fragment the matcher can emit. Kept in one file so the wording the GP
// reads is reviewable in one place, and so no call site invents its own phrasing for an age.
//
// Ages and durations render as words. A number of days is not a thing a referrer thinks in.

import type { AccessSource } from "./schema";

export function describeAge(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30.44)} months ago`;
  return `${Math.round(days / 365.25)} years ago`;
}

export function describeDuration(days: number): string {
  if (days < 14) return `${days} days`;
  if (days < 90) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30.44)} months`;
}

/** Where a fact came from, said the way a referrer would say it. */
export const SOURCE_COPY: Readonly<Record<AccessSource, string>> = {
  phone: "confirmed by phone",
  portal: "self-reported",
  "booking-platform": "from booking platform",
  "insurer-directory": "from fund directory",
  "state-health": "from published hospital data",
};

export function describeDistance(km: number): string {
  return `${km.toFixed(1)} km from patient postcode`;
}
