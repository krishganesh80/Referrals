// MOVEMENT. A point mass on the trail with gravity along the slope, rolling drag, a push, a brake,
// and a hop that is purely visual. No tricks, no grinds, no fall state: the worst that can happen
// is slowing down. Tuned for the feel of the reference recording's long glides, not its speed.
//
// Pure functions over a plain state object, so the loop in the ride is a few lines and the tests
// can run the whole trail without a canvas. DOM-free.

import { inFog, slopeAt, type FogBank } from "./trail";
import type { PreferenceKey } from "./preferences";

export interface RiderState {
  /** Metres along the trail. */
  readonly s: number;
  /** Metres per second along the trail. Never negative: the ride only goes forward. */
  readonly v: number;
  /** Visual hop height in metres and its velocity. Does not touch `s`. */
  readonly hopH: number;
  readonly hopV: number;
}

export interface Inputs {
  readonly push: boolean;
  readonly brake: boolean;
  readonly hop: boolean;
}

export const TUNING = {
  gravity: 9.8,
  /** How much of true gravity acts along the slope. Under one so the drop feels like a glide, not a fall. */
  gravityScale: 2.2,
  rollingDrag: 0.08,
  airDrag: 0.004,
  push: 9,
  /** Pushing does nothing past this speed: a rider cannot sprint the whole hill. */
  pushCeiling: 14,
  brake: 16,
  maxSpeed: 22,
  /** A fog bank is heavy air. */
  fogDrag: 0.12,
  hopVelocity: 3.6,
  hopGravity: 14,
  /** The rider settles to a stop within this many metres before a signpost. */
  settleDistance: 9,
  /** After a signpost the rider rolls off again at this speed. */
  rollOff: 5,
} as const;

export const REST: RiderState = { s: 0, v: 0, hopH: 0, hopV: 0 };

export interface StepContext {
  readonly cleared: ReadonlySet<PreferenceKey>;
  /** The next signpost's distance, when the rider has not answered it yet. */
  readonly stopAt: number | null;
}

export interface StepResult {
  readonly state: RiderState;
  /** The fog bank the rider is inside, for the renderer. */
  readonly fog: FogBank | null;
  /** True on the step the rider came to rest at `stopAt`. */
  readonly arrived: boolean;
}

export function step(state: RiderState, inputs: Inputs, dt: number, ctx: StepContext): StepResult {
  const d = Math.min(dt, 1 / 20);
  const slope = slopeAt(state.s);
  const theta = Math.atan(slope);
  const fog = inFog(state.s, ctx.cleared);

  let a = -TUNING.gravity * TUNING.gravityScale * Math.sin(theta);
  a -= TUNING.rollingDrag * state.v;
  a -= TUNING.airDrag * state.v * state.v;
  if (fog) a -= TUNING.fogDrag * state.v;
  if (inputs.push && state.v < TUNING.pushCeiling) a += TUNING.push;
  if (inputs.brake) a -= TUNING.brake;

  // The settle: an unanswered signpost ahead pulls the rider to a halt in front of it. This is
  // the one place the ride takes the controls away, and it does so to ask a question.
  let arrived = false;
  let v = state.v + a * d;
  let s = state.s;
  if (ctx.stopAt !== null) {
    const gap = ctx.stopAt - state.s;
    if (gap <= TUNING.settleDistance) {
      const target = Math.max(0, gap) * 1.4;
      v = Math.min(v, target);
      if (gap <= 0.25 || (gap <= 1.5 && v < 0.4)) {
        s = ctx.stopAt;
        v = 0;
        arrived = true;
      }
    }
  }
  v = Math.max(0, Math.min(TUNING.maxSpeed, v));
  if (!arrived) s = Math.min(state.s + v * d, Number.MAX_SAFE_INTEGER);

  let hopH = state.hopH;
  let hopV = state.hopV;
  if (inputs.hop && hopH === 0 && v > 0.5) hopV = TUNING.hopVelocity;
  if (hopH > 0 || hopV > 0) {
    hopV -= TUNING.hopGravity * d;
    hopH = Math.max(0, hopH + hopV * d);
    if (hopH === 0) hopV = 0;
  }

  return { state: { s, v, hopH, hopV }, fog, arrived };
}

/** Roll off from a signpost once it has been answered. */
export function rollOff(state: RiderState): RiderState {
  return { ...state, v: TUNING.rollOff };
}
