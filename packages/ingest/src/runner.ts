// The legal gate, and the only place adapters are executed.
//
// THE GATE CHECKS EVERY ADAPTER BEFORE IT RUNS ANY OF THEM. That ordering is the point: a run
// containing one uncleared source fetches nothing at all, rather than fetching the cleared ones
// and then failing. A partial run would leave snapshots on disk from a batch a human had not
// signed off, which is exactly the state the gate exists to prevent.

import { createHash } from "node:crypto";
import type { EvidenceTier, SourceRecord } from "@referral/core";
import {
  AdapterNotClearedError,
  PartialSurgeonSchema,
  type LegalStatus,
  type PartialSurgeon,
  type SourceAdapter,
} from "./types";

export interface IncomingRecord {
  readonly adapterId: string;
  /** Stamped from the adapter's defaultTier. The adapter never states its own tier. */
  readonly tier: EvidenceTier;
  readonly sourceRecord: SourceRecord;
  readonly partial: PartialSurgeon;
}

export interface RunReport {
  readonly ran: readonly string[];
  readonly refused: ReadonlyArray<{ adapterId: string; legalStatus: LegalStatus }>;
  readonly records: readonly IncomingRecord[];
  readonly failures: ReadonlyArray<{ adapterId: string; message: string }>;
}

export interface RunOptions {
  /**
   * Report uncleared adapters and run the rest, instead of refusing the whole batch. Off by
   * default — the safe reading of "refuse to execute" is to refuse.
   */
  readonly skipUncleared?: boolean;
}

export function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Which adapters in this batch may not be executed. */
export function unclearedAdapters(
  adapters: readonly SourceAdapter[],
): ReadonlyArray<{ adapterId: string; legalStatus: LegalStatus }> {
  return adapters
    .filter((a) => a.legalStatus !== "cleared")
    .map((a) => ({ adapterId: a.id, legalStatus: a.legalStatus }));
}

export async function runAdapters(
  adapters: readonly SourceAdapter[],
  options: RunOptions = {},
): Promise<RunReport> {
  const refused = unclearedAdapters(adapters);
  if (refused.length > 0 && options.skipUncleared !== true) {
    const first = refused[0]!;
    throw new AdapterNotClearedError(first.adapterId, first.legalStatus);
  }

  const runnable = adapters.filter((a) => a.legalStatus === "cleared");
  const ran: string[] = [];
  const records: IncomingRecord[] = [];
  const failures: Array<{ adapterId: string; message: string }> = [];

  for (const adapter of runnable) {
    try {
      const snapshot = await adapter.fetch();
      const partials = await adapter.parse(snapshot);
      const sourceRecord: SourceRecord = {
        id: `${adapter.id}:${snapshot.contentHash.slice(0, 12)}`,
        adapterId: adapter.id,
        fetchedAt: snapshot.fetchedAt,
        url: snapshot.url,
        snapshotHash: snapshot.contentHash,
      };
      for (const partial of partials) {
        records.push({
          adapterId: adapter.id,
          tier: adapter.defaultTier satisfies EvidenceTier,
          sourceRecord,
          partial: PartialSurgeonSchema.parse(partial),
        });
      }
      ran.push(adapter.id);
    } catch (error) {
      failures.push({
        adapterId: adapter.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ran, refused, records, failures };
}
