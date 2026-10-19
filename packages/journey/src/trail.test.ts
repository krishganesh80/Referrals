import { describe, expect, it } from "vitest";
import { CLEARING, CONTROL, FOG, LENGTH, SIGNPOSTS, heightAt, inFog, signpostsAreOrdered, slopeAt } from "./trail";

describe("the trail", () => {
  it("is monotone enough: it starts high, ends low, and never climbs back above the deck", () => {
    expect(heightAt(0)).toBeGreaterThan(heightAt(LENGTH));
    for (let s = 0; s <= LENGTH; s += 5) expect(heightAt(s)).toBeLessThanOrEqual(heightAt(0));
  });

  it("passes through every control point", () => {
    for (const p of CONTROL) expect(heightAt(p.s)).toBeCloseTo(p.h, 6);
  });

  it("has no slope steeper than a gentle 60 degrees anywhere, drop included", () => {
    for (let s = 0; s <= LENGTH; s += 1) expect(Math.abs(slopeAt(s))).toBeLessThan(Math.tan((60 * Math.PI) / 180));
  });

  it("places the six signposts in preference order before the clearing", () => {
    expect(SIGNPOSTS).toHaveLength(6);
    expect(signpostsAreOrdered()).toBe(true);
    expect(CLEARING).toBeLessThan(LENGTH);
  });

  it("puts each fog bank after the signpost that clears it, and never over a signpost", () => {
    for (const f of FOG) {
      const sp = SIGNPOSTS.find((p) => p.key === f.clearedBy)!;
      expect(f.from).toBeGreaterThan(sp.s);
      for (const other of SIGNPOSTS) expect(other.s < f.from || other.s > f.to).toBe(true);
    }
  });

  it("a chosen preference clears its fog and nothing else", () => {
    const f = FOG[0]!;
    const mid = (f.from + f.to) / 2;
    expect(inFog(mid, new Set())).toBe(f);
    expect(inFog(mid, new Set([f.clearedBy]))).toBeNull();
    expect(inFog(mid, new Set(["language"]))).toBe(f);
  });
});
