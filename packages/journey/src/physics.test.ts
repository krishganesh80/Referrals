import { describe, expect, it } from "vitest";
import { REST, TUNING, rollOff, step, type Inputs, type RiderState } from "./physics";
import { CLEARING, SIGNPOSTS } from "./trail";

const IDLE: Inputs = { push: false, brake: false, hop: false };
const DT = 1 / 60;

function run(from: RiderState, inputs: Inputs, seconds: number, stopAt: number | null, cleared = new Set<never>()) {
  let state = from;
  let arrived = false;
  for (let t = 0; t < seconds; t += DT) {
    const r = step(state, inputs, DT, { cleared, stopAt });
    state = r.state;
    if (r.arrived) {
      arrived = true;
      break;
    }
  }
  return { state, arrived };
}

describe("movement", () => {
  it("a rider who touches nothing still leaves the deck and reaches the first signpost", () => {
    // The deck is flat, so the first push is the one thing the ride asks for. After that, gravity.
    const pushed = run(REST, { ...IDLE, push: true }, 2, SIGNPOSTS[0]!.s);
    const { arrived } = run(pushed.state, IDLE, 60, SIGNPOSTS[0]!.s);
    expect(arrived).toBe(true);
  });

  it("settles exactly at the signpost and does not pass it", () => {
    const pushed = run(REST, { ...IDLE, push: true }, 2, SIGNPOSTS[0]!.s);
    const { state, arrived } = run(pushed.state, { ...IDLE, push: true }, 60, SIGNPOSTS[0]!.s);
    expect(arrived).toBe(true);
    expect(state.s).toBe(SIGNPOSTS[0]!.s);
    expect(state.v).toBe(0);
  });

  it("never exceeds the speed cap, even pushing down the drop", () => {
    let state = REST;
    for (let t = 0; t < 30; t += DT) {
      state = step(state, { ...IDLE, push: true }, DT, { cleared: new Set(), stopAt: null }).state;
      expect(state.v).toBeLessThanOrEqual(TUNING.maxSpeed);
    }
  });

  it("never rolls backwards", () => {
    let state: RiderState = { s: 60, v: 0.2, hopH: 0, hopV: 0 };
    for (let t = 0; t < 10; t += DT) {
      state = step(state, { ...IDLE, brake: true }, DT, { cleared: new Set(), stopAt: null }).state;
      expect(state.v).toBeGreaterThanOrEqual(0);
    }
  });

  it("fog slows the rider and clearing it does not", () => {
    const start: RiderState = { s: 200, v: 10, hopH: 0, hopV: 0 };
    const inFog = step(start, IDLE, DT, { cleared: new Set(), stopAt: null });
    const clear = step(start, IDLE, DT, { cleared: new Set(["telehealth"]), stopAt: null });
    expect(inFog.fog).not.toBeNull();
    expect(clear.fog).toBeNull();
    expect(inFog.state.v).toBeLessThan(clear.state.v);
  });

  it("a hop rises, lands, and never moves the rider along the trail by itself", () => {
    const start: RiderState = { s: 300, v: 6, hopH: 0, hopV: 0 };
    const noHop = step(start, IDLE, DT, { cleared: new Set(), stopAt: null }).state;
    let state = step(start, { ...IDLE, hop: true }, DT, { cleared: new Set(), stopAt: null }).state;
    expect(state.s).toBeCloseTo(noHop.s, 9);
    let peak = 0;
    for (let t = 0; t < 3; t += DT) {
      state = step(state, IDLE, DT, { cleared: new Set(), stopAt: null }).state;
      peak = Math.max(peak, state.hopH);
    }
    expect(peak).toBeGreaterThan(0.2);
    expect(state.hopH).toBe(0);
  });

  it("answering every signpost and rolling off reaches the clearing without a single push", () => {
    let state = run(REST, { ...IDLE, push: true }, 2, SIGNPOSTS[0]!.s).state;
    for (const sp of SIGNPOSTS) {
      const r = run(state, IDLE, 90, sp.s);
      expect(r.arrived, `signpost ${sp.key}`).toBe(true);
      state = rollOff(r.state);
    }
    const end = run(state, IDLE, 90, null);
    expect(end.state.s).toBeGreaterThanOrEqual(CLEARING);
  });
});
