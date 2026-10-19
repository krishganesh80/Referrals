// THE TRAIL. One line from a high platform down to a valley clearing, described by control points
// and read back as a smooth height for any distance along it. The shape borrows the reference
// recording's run — a drop-in from a deck, a bowl, a rise, a tunnel, a long glide out — without
// any of its difficulty: every slope is gentle enough that a rider who never touches a key still
// arrives.
//
// Distances are in metres along the ground (`s`); heights are metres up (`h`). DOM-free.

import { PREFERENCES, type PreferenceKey } from "./preferences";

export interface Point {
  readonly s: number;
  readonly h: number;
}

/** The ride's skeleton. Keep it short: the whole thing reads in under two minutes at walking pace. */
export const CONTROL: ReadonlyArray<Point> = [
  { s: 0, h: 120 }, // deck
  { s: 24, h: 120 },
  { s: 110, h: 64 }, // the drop
  { s: 170, h: 46 }, // bowl floor
  { s: 230, h: 48 }, // bowl lip, a small one
  { s: 330, h: 40 },
  { s: 420, h: 35 },
  { s: 470, h: 31 },
  { s: 500, h: 30 }, // the long shoulder before the tunnel
  { s: 560, h: 26 },
  { s: 660, h: 20 }, // tunnel floor
  { s: 800, h: 9 }, // the glide
  { s: 860, h: 6 }, // clearing
  { s: 940, h: 6 },
];

export const LENGTH = CONTROL[CONTROL.length - 1]!.s;
export const DECK_END = 24;
export const TUNNEL = { from: 590, to: 660 } as const;
export const CLEARING = 860;

export interface Signpost {
  readonly key: PreferenceKey;
  readonly s: number;
}

/** Six signposts, one per preference, in trail order. Spaced so the rider settles between them. */
export const SIGNPOSTS: ReadonlyArray<Signpost> = [
  { key: "telehealth", s: 125 },
  { key: "bulkBilling", s: 300 },
  { key: "longerAppointments", s: 400 },
  { key: "wheelchair", s: 520 },
  { key: "openBooks", s: 700 },
  { key: "language", s: 790 },
];

export interface FogBank {
  /** Choosing this preference clears the bank. */
  readonly clearedBy: PreferenceKey;
  readonly from: number;
  readonly to: number;
}

/** Five fog banks, each sitting after the signpost that clears it. The sixth preference lights the clearing. */
export const FOG: ReadonlyArray<FogBank> = [
  { clearedBy: "telehealth", from: 200, to: 250 },
  { clearedBy: "bulkBilling", from: 340, to: 380 },
  { clearedBy: "longerAppointments", from: 440, to: 475 },
  { clearedBy: "wheelchair", from: 545, to: 580 },
  { clearedBy: "openBooks", from: 730, to: 765 },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Height at `s`, cosine-smoothed between control points so slopes have no corners. */
export function heightAt(s: number): number {
  const x = clamp(s, 0, LENGTH);
  for (let i = 0; i < CONTROL.length - 1; i++) {
    const a = CONTROL[i]!;
    const b = CONTROL[i + 1]!;
    if (x >= a.s && x <= b.s) {
      const t = b.s === a.s ? 0 : (x - a.s) / (b.s - a.s);
      const k = (1 - Math.cos(t * Math.PI)) / 2;
      return a.h + (b.h - a.h) * k;
    }
  }
  return CONTROL[CONTROL.length - 1]!.h;
}

/** dh/ds at `s`: negative going downhill. Central difference; the trail is smooth, so this is enough. */
export function slopeAt(s: number): number {
  const e = 0.5;
  return (heightAt(s + e) - heightAt(s - e)) / (2 * e);
}

export function inFog(s: number, cleared: ReadonlySet<PreferenceKey>): FogBank | null {
  for (const f of FOG) if (s >= f.from && s <= f.to && !cleared.has(f.clearedBy)) return f;
  return null;
}

export function inTunnel(s: number): boolean {
  return s >= TUNNEL.from && s <= TUNNEL.to;
}

/** Sanity used by the tests and by nobody else: every signpost sits on the trail and in preference order. */
export function signpostsAreOrdered(): boolean {
  const order = PREFERENCES.map((p) => p.key);
  return SIGNPOSTS.every((sp, i) => sp.key === order[i] && sp.s > 0 && sp.s < CLEARING && (i === 0 || sp.s > SIGNPOSTS[i - 1]!.s));
}
