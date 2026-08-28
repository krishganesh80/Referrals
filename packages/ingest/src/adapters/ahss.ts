// Australian Hand Surgery Society — the public directory at
// https://ahss.org.au/hand-surgery-public-directory/
//
// Tier A: society membership is a surgeon telling their peers what they do, which is a far
// harder statement than a practice website.
//
// WHAT THIS SOURCE DOES NOT CARRY, AND WHY IT MATTERS. There is no AHPRA number anywhere in the
// listing. Every record therefore leaves here with `ahpraId: null`, which means reconciliation
// will never auto-merge it — it becomes a review item with a stated basis. That is the correct
// outcome, not a shortfall: a society directory can confirm what somebody does, but only the
// register can say who they are. Until the AHPRA source is running, this adapter produces a
// review queue rather than records, and it should.
//
// Two further limits, both deliberate rather than overlooked:
//
//   THE `cusBox VIC` CLASS ON EACH COLUMN IS NOT A STATE. The first entry in the live page is
//   classed VIC and its practice is in Kogarah, NSW. It is a layout artefact. State is read from
//   the address text or left null.
//
//   NAMES ARE SPLIT LAST-TOKEN-FIRST. "Nav Aggarwal" splits correctly; "Van Der Berg" would not.
//   Since every record from here goes to human review anyway, a bad split is caught by a person
//   rather than silently written to a record.

import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import type { PartialSurgeon, RawSnapshot, SourceAdapter } from "../types";
import type { FetchPolicy } from "../fetch-policy";

export const AHSS_ADAPTER_ID = "society-hand";
export const AHSS_DIRECTORY_URL = "https://ahss.org.au/hand-surgery-public-directory/";

const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"] as const;

export interface AhssEntry {
  readonly directoryUserId: string | null;
  readonly displayName: string;
  readonly practiceName: string | null;
  readonly practiceAddress: string | null;
}

function textOf(node: HTMLElement | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The value after a bolded label, e.g. `<b>PRACTICE NAME:</b> Southern Hand Surgery`. */
function labelledValue(container: HTMLElement, label: string): string | null {
  for (const block of container.querySelectorAll(".textFlex")) {
    const bold = block.querySelector("b");
    if (!bold) continue;
    if (textOf(bold).toUpperCase().replace(/:$/, "") !== label) continue;
    const whole = textOf(block);
    const value = whole.slice(textOf(bold).length).trim();
    return value === "" ? null : value;
  }
  return null;
}

/** Structure-level extraction, kept separate from the mapping so both can be tested. */
export function extractAhssEntries(html: string): AhssEntry[] {
  const root = parseHtml(html);
  const entries: AhssEntry[] = [];
  for (const nameBlock of root.querySelectorAll(".cs-directory-name")) {
    const displayName = textOf(nameBlock.querySelector("p")) || nameBlock.getAttribute("alt") || "";
    if (displayName === "") continue;
    const id = nameBlock.getAttribute("id");
    // The address block is the sibling that follows the name block within the same widget.
    const container = nameBlock.parentNode;
    const addressBox = container?.querySelector(".addressBox") ?? null;
    entries.push({
      directoryUserId: id ?? null,
      displayName,
      practiceName: addressBox ? labelledValue(addressBox, "PRACTICE NAME") : null,
      practiceAddress: addressBox ? labelledValue(addressBox, "PRACTICE ADDRESS") : null,
    });
  }
  return entries;
}

export function splitName(displayName: string): { givenNames: string; familyName: string } {
  const parts = displayName.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { givenNames: parts[0]!, familyName: parts[0]! };
  return {
    givenNames: parts.slice(0, -1).join(" "),
    familyName: parts[parts.length - 1]!,
  };
}

/** A four-digit group that is a plausible Australian postcode, if the address carries one. */
export function postcodeFrom(address: string | null): string | null {
  if (address === null) return null;
  const matches = address.match(/\b(\d{4})\b/g);
  const last = matches?.[matches.length - 1] ?? null;
  return last ?? null;
}

export function stateFrom(address: string | null): string | null {
  if (address === null) return null;
  for (const state of AU_STATES) {
    if (new RegExp(`\\b${state}\\b`).test(address.toUpperCase())) return state;
  }
  return null;
}

export function toPartialSurgeons(entries: readonly AhssEntry[]): PartialSurgeon[] {
  return entries.map((entry) => {
    const { givenNames, familyName } = splitName(entry.displayName);
    return {
      // The directory publishes no registration number, so identity stays unresolved here.
      ahpraId: null,
      familyName,
      givenNames,
      postcodeHint: postcodeFrom(entry.practiceAddress),
      specialistRegistrationSince: null,
      tags: [
        {
          bucket: "hand_wrist" as const,
          evidence: "Australian Hand Surgery Society member",
        },
      ],
      // A directory line is not a verified practice location: there is no geocode, usually no
      // postcode and often no state. Locations come from sources that publish them properly.
      locations: [],
      languages: [],
      telehealth: null,
    };
  });
}

export function parseAhssDirectory(html: string): PartialSurgeon[] {
  return toPartialSurgeons(extractAhssEntries(html));
}

export function ahssDirectoryAdapter(policy: FetchPolicy): SourceAdapter {
  return {
    id: AHSS_ADAPTER_ID,
    legalStatus: "needs-review",
    defaultTier: "A",
    description:
      "Australian Hand Surgery Society public directory. Membership implies the hand_wrist bucket. Publishes no AHPRA number, so every record routes to review.",
    fetch: (): Promise<RawSnapshot> => policy.snapshot(AHSS_ADAPTER_ID, AHSS_DIRECTORY_URL),
    parse: (snapshot: RawSnapshot): Promise<PartialSurgeon[]> =>
      Promise.resolve(parseAhssDirectory(snapshot.body)),
  };
}
