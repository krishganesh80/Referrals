// Server side: aggregate on write, suppress below the threshold, drop the raw.
//
// THE SUPPRESSION IS STRUCTURAL, NOT A FILTER SOMEBODY REMEMBERS TO APPLY. The cell map is
// private and there is exactly one read path off this class; it applies the threshold before it
// returns. A downstream consumer cannot reach an under-threshold cell because there is no method
// that would give them one.
//
// RAW PINGS ARE DROPPED AT 30 DAYS, COUNTS SURVIVE. Distinct-install counting needs the token set
// while it is being built; after the retention window the set is discarded and the count it
// produced is kept. The consequence is honest and worth stating: once a window closes we can no
// longer tell a repeat install from a new one, so the count is frozen rather than silently drifting.

import { PingSchema, type Outcome, type Ping } from "./payload";

/** A cell is readable only once this many DISTINCT installs have reported it. */
export const K_ANONYMITY_THRESHOLD = 5;

export const RAW_RETENTION_DAYS = 30;

/** Off by default, per practice, opt-in. Nothing is sent until a practice turns it on. */
export const SIGNALS_ENABLED_BY_DEFAULT = false;

export interface PublishedCell {
  readonly surgeonId: string;
  readonly weekBucket: string;
  readonly accepted: number;
  readonly declined: number;
  readonly noResponse: number;
  readonly distinctInstalls: number;
}

interface InternalCell {
  accepted: number;
  declined: number;
  noResponse: number;
  distinctInstalls: number;
  /** Dropped once the retention window closes; the count above survives. */
  tokens: Set<string> | null;
  firstSeenDay: number;
}

const OUTCOME_FIELD: Readonly<Record<Outcome, "accepted" | "declined" | "noResponse">> = {
  accepted: "accepted",
  declined: "declined",
  "no-response": "noResponse",
};

const cellKey = (surgeonId: string, weekBucket: string) => `${surgeonId}|${weekBucket}`;

export class SignalStore {
  readonly #cells = new Map<string, InternalCell>();

  /**
   * Aggregate on write. The ping itself is never retained — only its effect on a counter and,
   * for the retention window, its install token so distinct installs can be counted.
   *
   * `receivedAt` is a server receipt day, not part of the payload and never finer than a day.
   * No IP is passed in, because none is ever logged.
   */
  record(ping: unknown, receivedAt: Date): void {
    const parsed = PingSchema.parse(ping);
    const key = cellKey(parsed.surgeonId, parsed.weekBucket);
    const day = Math.floor(receivedAt.getTime() / 86_400_000);
    const cell =
      this.#cells.get(key) ??
      { accepted: 0, declined: 0, noResponse: 0, distinctInstalls: 0, tokens: new Set<string>(), firstSeenDay: day };

    cell[OUTCOME_FIELD[parsed.outcome]] += 1;
    if (cell.tokens && !cell.tokens.has(parsed.installToken)) {
      cell.tokens.add(parsed.installToken);
      cell.distinctInstalls += 1;
    }
    this.#cells.set(key, cell);
  }

  /** Discard install tokens past the retention window. Counts are kept; the raw is not. */
  dropExpiredRaw(now: Date): number {
    const today = Math.floor(now.getTime() / 86_400_000);
    let dropped = 0;
    for (const cell of this.#cells.values()) {
      if (cell.tokens !== null && today - cell.firstSeenDay > RAW_RETENTION_DAYS) {
        cell.tokens = null;
        dropped += 1;
      }
    }
    return dropped;
  }

  /** True if any install token is still held anywhere. Used to prove retention actually ran. */
  holdsRawTokens(): boolean {
    for (const cell of this.#cells.values()) if (cell.tokens !== null) return true;
    return false;
  }

  /**
   * THE ONLY READ PATH. Suppression is applied here, so nothing downstream can be handed a cell
   * that fewer than K distinct installs reported.
   */
  read(): PublishedCell[] {
    const out: PublishedCell[] = [];
    for (const [key, cell] of this.#cells) {
      if (cell.distinctInstalls < K_ANONYMITY_THRESHOLD) continue;
      const [surgeonId = "", weekBucket = ""] = key.split("|");
      out.push({
        surgeonId,
        weekBucket,
        accepted: cell.accepted,
        declined: cell.declined,
        noResponse: cell.noResponse,
        distinctInstalls: cell.distinctInstalls,
      });
    }
    return out.sort((a, b) =>
      a.surgeonId === b.surgeonId ? a.weekBucket.localeCompare(b.weekBucket) : a.surgeonId.localeCompare(b.surgeonId),
    );
  }

  /** How many cells exist in total, readable or not. A count, never their contents. */
  get cellCount(): number {
    return this.#cells.size;
  }
}

/** Convenience for a batch. Same rules; there is no bulk path that skips validation. */
export function ingestBatch(store: SignalStore, pings: readonly unknown[], receivedAt: Date): void {
  for (const ping of pings) store.record(ping, receivedAt);
}

export type { Ping };
