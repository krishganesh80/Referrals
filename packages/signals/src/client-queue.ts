// Client side: queue locally, submit batched weekly, never alongside a match.
//
// The timing rule is not fussiness. If a submission went out on the same request cycle as a
// match, the moment of sending would itself correlate with the moment of searching, and an
// observer watching the network — not the payload — could tell when a GP looked somebody up.
// The payload being empty of clinical content would not save it.

import type { Ping } from "./payload";

export const SUBMIT_INTERVAL_DAYS = 7;

export interface QueueState {
  readonly pending: readonly Ping[];
  readonly lastSubmittedAt: number | null;
  /** Off by default. A practice opts in after seeing the exact payload shape. */
  readonly enabled: boolean;
  /** Set while a match is in flight; submission is refused for that cycle. */
  readonly matchInFlight: boolean;
}

export function emptyQueue(): QueueState {
  return { pending: [], lastSubmittedAt: null, enabled: false, matchInFlight: false };
}

export function enqueue(state: QueueState, ping: Ping): QueueState {
  // Nothing is recorded at all while the practice has not opted in — not queued for later.
  if (!state.enabled) return state;
  return { ...state, pending: [...state.pending, ping] };
}

export function shouldSubmit(state: QueueState, now: Date): boolean {
  if (!state.enabled) return false;
  if (state.matchInFlight) return false;
  if (state.pending.length === 0) return false;
  if (state.lastSubmittedAt === null) return true;
  return now.getTime() - state.lastSubmittedAt >= SUBMIT_INTERVAL_DAYS * 86_400_000;
}

export function markSubmitted(state: QueueState, now: Date): QueueState {
  return { ...state, pending: [], lastSubmittedAt: now.getTime() };
}
