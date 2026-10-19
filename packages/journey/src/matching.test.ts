import { describe, expect, it } from "vitest";
import { match, missingLine, reasonLines } from "./matching";
import { emptySelection, PREFERENCES, withChoice, type Selection } from "./preferences";
import { DEMO_ROSTER } from "./roster";

describe("demo matching", () => {
  it("with nothing chosen, everyone fits and nobody is close or hidden", () => {
    const r = match(emptySelection());
    expect(r.fits).toHaveLength(DEMO_ROSTER.length);
    expect(r.close).toHaveLength(0);
    expect(r.hidden).toBe(0);
  });

  it("chosen preferences combine as AND, as the finder's own filter does", () => {
    const s = withChoice(withChoice(emptySelection(), "telehealth", true), "bulkBilling", true);
    const r = match(s);
    for (const m of r.fits) {
      expect(m.clinician.telehealthFirstAppointment).toBe(true);
      expect(m.clinician.bulkBilling).toBe(true);
      expect(m.misses).toHaveLength(0);
    }
    for (const m of r.close) expect(m.misses).toHaveLength(1);
    expect(r.fits.length + r.close.length + r.hidden).toBe(DEMO_ROSTER.length);
  });

  it("a language is only met by a clinician who declares that language", () => {
    const r = match(withChoice(emptySelection(), "language", "Greek"));
    expect(r.fits.map((m) => m.clinician.id).sort()).toEqual(["boronia", "kunzea"]);
    expect(r.close).toHaveLength(0);
  });

  it("orders within a group alphabetically, so position is never a rank", () => {
    const r = match(withChoice(emptySelection(), "openBooks", true));
    const names = r.fits.map((m) => m.clinician.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en-AU")));
  });

  it("is deterministic: the same selection yields the same list", () => {
    const s: Selection = { ...emptySelection(), wheelchair: true, longerAppointments: true };
    expect(match(s)).toEqual(match(s));
  });

  it("every chosen preference can be met by at least one invented clinician, alone", () => {
    for (const p of PREFERENCES) {
      const s = withChoice(emptySelection(), p.key, p.key === "language" ? "Mandarin" : true);
      expect(match(s).fits.length, p.key).toBeGreaterThan(0);
    }
  });

  it("explains a card only with the chosen preferences it meets", () => {
    const s = withChoice(withChoice(emptySelection(), "telehealth", true), "language", "Hindi");
    const r = match(s);
    const sol = r.fits.find((m) => m.clinician.id === "callistemon");
    expect(sol && reasonLines(sol, s)).toEqual(["Telehealth suits me", "Speaks Hindi"]);
    const ren = r.fits.find((m) => m.clinician.id === "eucalypt");
    expect(ren).toBeDefined();
    const nearMiss = r.close.find((m) => m.clinician.id === "banksia");
    expect(nearMiss && missingLine(nearMiss, s)).toBe("Does not declare Hindi");
  });
});
